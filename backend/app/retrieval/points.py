"""What gets indexed: nodes and **approved** artifacts turned into point specs.

Pure reads from Postgres, no vectors. Each `PointSpec` carries the text to embed, the
payload of §10, and a content hash; `indexing` compares hashes (and `model_id`) against
what Qdrant holds so only changed points are re-embedded.

Point ids are UUIDv5, stable across runs and re-parses (anchors are stable, D4):
blocks `(document_id, anchor)`, distillations `(document_id, anchor, type[, note_id])`,
documents the document id itself (the `with_lookup` join target).
"""

import hashlib
import re
import uuid
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Any

from sqlmodel import Session, col, select

from app.models import Artifact, Document, Node
from app.models.enums import ArtifactType, NodeKind, Review
from app.pipeline.bodies import iter_objects
from app.pipeline.hashing import canonical_json
from app.pipeline.tree import Tree
from app.services.render_markdown import body_blocks

NAMESPACE = uuid.UUID("6f1c2d4e-8a1b-5c3d-9e7f-b00c5e1f0a11")

# BM25 `avg_len` per collection, in words (see `embedding`): blocks are paragraphs,
# distillation points are whole artifact bodies (summaries to chapter distillations).
BLOCKS_AVG_LEN = 80.0
DISTILLATIONS_AVG_LEN = 400.0

PAYLOAD_TEXT_MAX = 4000  # chars kept on the point for snippets and reranking

# Artifact types indexed into `distillations`: prose a reader would search. Outline
# overrides, concept links and study aids (quiz, flashcards) are not knowledge claims.
INDEXED_TYPES = frozenset(
    {
        ArtifactType.CHAPTER_SUMMARY,
        ArtifactType.BOOK_SUMMARY,
        ArtifactType.SECTION_NOTE,
        ArtifactType.CHAPTER_DISTILLATION,
        ArtifactType.BOOK_BRIEF,
        ArtifactType.BOOK_GUIDE,
        ArtifactType.FIGURE_DESCRIPTION,
        ArtifactType.CODE_EXPLANATION,
        ArtifactType.MATH_DESCRIPTION,
        ArtifactType.TABLE_EXPLANATION,
        ArtifactType.STRUCTURED_NOTE,
        ArtifactType.QUOTE_SET,
        ArtifactType.FAQ,
        ArtifactType.GLOSSARY,
    }
)

_CHAPTER_NO = re.compile(r"(\d+)$")
_BODY_TEXT_KEYS = ("title", "term", "question", "caption", "text")


@dataclass(frozen=True, slots=True)
class PointSpec:
    id: str
    text: str
    payload: dict[str, Any]

    @property
    def content_hash(self) -> str:
        return str(self.payload["content_hash"])


def block_point_id(document_id: uuid.UUID, anchor: str) -> str:
    return str(uuid.uuid5(NAMESPACE, f"block:{document_id}:{anchor}"))


def distillation_point_id(
    document_id: uuid.UUID, anchor: str | None, kind: ArtifactType, note_id: uuid.UUID | None
) -> str:
    key = f"distillation:{document_id}:{anchor or ''}:{kind.value}"
    return str(uuid.uuid5(NAMESPACE, f"{key}:{note_id}" if note_id else key))


def content_hash(text: str, avg_len: float) -> str:
    raw = canonical_json({"text": text, "avg_len": avg_len})
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


# --- Text -----------------------------------------------------------------------------


def _table_text(meta: dict[str, Any]) -> list[str]:
    nested = meta.get("table")
    table: dict[str, Any] = nested if isinstance(nested, dict) else meta
    header = table.get("header") or []
    rows = table.get("rows") or []
    lines = [" | ".join(str(c) for c in header)] if header else []
    lines += [" | ".join(str(c) for c in row) for row in rows if isinstance(row, list)]
    return lines


def node_text(node: Node) -> str:
    """A leaf as plain text: caption, body, and table cells or LaTeX where present."""
    meta = node.meta or {}
    parts = [meta["caption"]] if isinstance(meta.get("caption"), str) else []
    if node.text:
        parts.append(node.text)
    if node.kind is NodeKind.TABLE:
        parts += _table_text(meta)
    if isinstance(meta.get("latex"), str):
        parts.append(meta["latex"])
    return "\n".join(p.strip() for p in parts if p and p.strip())


def flatten_body(body: dict[str, Any]) -> str:
    """An artifact body as plain text: walk its render blocks, keep every text-bearing
    field (headings, spans, terms, captions) in reading order."""
    parts: list[str] = []
    for obj in iter_objects(body_blocks(body)):
        parts += [obj[k] for k in _BODY_TEXT_KEYS if isinstance(obj.get(k), str) and obj[k]]
    return "\n".join(parts)


# --- Blocks ---------------------------------------------------------------------------


def _chapter_no(tree: Tree, node: Node) -> int | None:
    chapter = tree.chapter_of(node)
    if chapter is None:
        return None
    match = _CHAPTER_NO.search(chapter.anchor.split("/")[0])
    return int(match.group(1)) if match else None


def block_points(tree: Tree, *, model_id: str) -> list[PointSpec]:
    """One point per visible leaf with text."""
    document = tree.document
    specs = []
    for node in tree.leaves():
        text = node_text(node)
        if not text:
            continue
        ancestors = tree.ancestors(node)
        payload = {
            "document_id": str(document.id),
            "anchor": node.anchor,
            "chapter_no": _chapter_no(tree, node),
            "section_path": [a.anchor for a in reversed(ancestors)],
            "kind": node.kind.value,
            "tags": list(document.tags),
            "char_len": len(text),
            "model_id": model_id,
            "heading": next((a.heading for a in ancestors if a.heading), None),
            "page": node.page_from,
            "text": text[:PAYLOAD_TEXT_MAX],
            "content_hash": content_hash(text, BLOCKS_AVG_LEN),
        }
        specs.append(PointSpec(block_point_id(document.id, node.anchor), text, payload))
    return specs


# --- Distillations --------------------------------------------------------------------


def approved_artifacts(session: Session, document_id: uuid.UUID) -> list[Artifact]:
    """The latest approved version per (anchor, type, note) of every indexed type."""
    rows = session.exec(
        select(Artifact)
        .where(
            Artifact.document_id == document_id,
            Artifact.review == Review.APPROVED,
            col(Artifact.type).in_(list(INDEXED_TYPES)),
        )
        .order_by(col(Artifact.version).desc(), col(Artifact.created_at).desc())
    ).all()
    latest: dict[tuple[str | None, ArtifactType, uuid.UUID | None], Artifact] = {}
    for artifact in rows:
        latest.setdefault((artifact.anchor, artifact.type, artifact.note_id), artifact)
    return list(latest.values())


def level_of(tree: Tree, anchor: str | None, note_id: uuid.UUID | None) -> str:
    """`document`, a container kind (`part`/`chapter`/`section`), `block`, or `note`."""
    if note_id is not None:
        return "note"
    if anchor is None:
        return "document"
    node = tree.by_anchor.get(anchor)
    if node is None:
        return "block"
    return node.kind.value if node.kind.is_container else "block"


def _artifact_tags(document: Document, artifact: Artifact) -> list[str]:
    extra = artifact.body.get("tags")
    own = [t for t in extra if isinstance(t, str)] if isinstance(extra, list) else []
    return sorted({*document.tags, *own})


def distillation_points(
    tree: Tree, artifacts: Sequence[Artifact], *, model_id: str
) -> list[PointSpec]:
    document = tree.document
    specs = []
    for artifact in artifacts:
        scope = tree.by_anchor.get(artifact.anchor) if artifact.anchor else None
        heading = (scope.heading if scope else None) or (
            document.title if artifact.anchor is None else None
        )
        body_text = flatten_body(artifact.body)
        if not body_text:
            continue
        text = f"{heading}\n{body_text}" if heading else body_text
        payload = {
            "document_id": str(document.id),
            "anchor": artifact.anchor,
            "type": artifact.type.value,
            "level": level_of(tree, artifact.anchor, artifact.note_id),
            "tags": _artifact_tags(document, artifact),
            "review": artifact.review.value,
            "model_id": model_id,
            "artifact_id": str(artifact.id),
            "heading": heading,
            "text": text[:PAYLOAD_TEXT_MAX],
            "content_hash": content_hash(text, DISTILLATIONS_AVG_LEN),
        }
        point_id = distillation_point_id(
            document.id, artifact.anchor, artifact.type, artifact.note_id
        )
        specs.append(PointSpec(point_id, text, payload))
    return specs


# --- Documents ------------------------------------------------------------------------


def document_payload(document: Document) -> dict[str, Any]:
    """The `documents` point: metadata only, joined in by `with_lookup`."""
    return {
        "document_id": str(document.id),
        "slug": document.slug,
        "title": document.title,
        "authors": list(document.authors),
        "year": document.year,
        "tags": list(document.tags),
        "kind": document.kind.value,
    }


def all_documents(session: Session) -> Iterable[Document]:
    return session.exec(select(Document).order_by(col(Document.created_at))).all()

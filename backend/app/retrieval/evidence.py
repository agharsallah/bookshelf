"""The evidence set behind an answer, and the cite scheme that points into it.

Answers span documents, but a render-contract anchor (`ch03/s02/p014`) is only unique
inside one document. Answer cites are therefore **qualified**: `<slug>:<anchor>`, e.g.
`meadows-systems:ch03/s02/p014`. `:` never occurs in a slug or an anchor, so the split is
unambiguous, and the frontend resolves a cite through the `sources` map it is sent with.

Valid cites are exactly the evidence the model was shown: the passages themselves, the
scope anchors of the distillations, and the anchors those distillations already cite
(which passed the anchor gate when the artifact was stored).
"""

import uuid
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Literal

from sqlmodel import Session, col, select

from app.models import Artifact, Node
from app.models.enums import NodeKind
from app.pipeline.bodies import leaf_spans
from app.retrieval.points import node_text
from app.schemas.search import DocumentRef, SearchResponse
from app.services.render_markdown import body_blocks
from app.services.sql import anchor_under

MAX_DISTILLATIONS = 6
MAX_PASSAGES = 16
PASSAGE_CHARS = 1200
DISTILLATION_CHARS = 4000


def qualify(slug: str, anchor: str) -> str:
    return f"{slug}:{anchor}"


def split_cite(cite: str) -> tuple[str | None, str]:
    """`slug:anchor` → (slug, anchor); a bare anchor → (None, anchor)."""
    slug, sep, anchor = cite.partition(":")
    return (slug, anchor) if sep else (None, cite)


@dataclass(slots=True)
class EvidenceItem:
    kind: Literal["distillation", "passage"]
    document: DocumentRef
    anchor: str | None
    label: str  # the bracketed key the prompt shows: `slug:anchor`, or `slug` for a book
    detail: str  # "passage", or the artifact type
    text: str


@dataclass(slots=True)
class Evidence:
    items: list[EvidenceItem] = field(default_factory=list)
    valid: dict[str, tuple[DocumentRef, str]] = field(default_factory=dict)

    def allow(self, document: DocumentRef, anchor: str) -> None:
        self.valid.setdefault(qualify(document.slug, anchor), (document, anchor))

    @property
    def documents(self) -> list[DocumentRef]:
        seen: dict[uuid.UUID, DocumentRef] = {}
        for item in self.items:
            seen.setdefault(item.document.id, item.document)
        return list(seen.values())


def cited_text(body: dict[str, object], slug: str) -> str:
    """A body's spans with their cites inline and qualified: `text [slug:ch01/p002]`."""
    parts = []
    for span in leaf_spans(body_blocks(dict(body))):
        cites = [qualify(slug, c) for c in span["cites"] if isinstance(c, str)]
        parts.append(f"{span['text']} [{'; '.join(cites)}]" if cites else span["text"])
    return "\n".join(parts)


def _passages(session: Session, document_id: uuid.UUID, anchors: Iterable[str]) -> dict[str, Node]:
    wanted = list(dict.fromkeys(anchors))
    if not wanted:
        return {}
    rows = session.exec(
        select(Node).where(Node.document_id == document_id, col(Node.anchor).in_(wanted))
    ).all()
    return {n.anchor: n for n in rows}


def _leaves_under(session: Session, document_id: uuid.UUID, anchor: str) -> list[Node]:
    containers = [k for k in NodeKind if k.is_container]
    rows = session.exec(
        select(Node)
        .where(
            Node.document_id == document_id,
            anchor_under(col(Node.anchor), anchor),
            col(Node.kind).not_in(containers),
        )
        .order_by(col(Node.anchor))
        .limit(MAX_PASSAGES)
    ).all()
    return list(rows)


def _add_passage(evidence: Evidence, document: DocumentRef, node: Node) -> None:
    text = node_text(node)
    if not text:
        return
    evidence.items.append(
        EvidenceItem(
            "passage",
            document,
            node.anchor,
            qualify(document.slug, node.anchor),
            "passage",
            text[:PASSAGE_CHARS],
        )
    )
    evidence.allow(document, node.anchor)


def gather(session: Session, response: SearchResponse) -> Evidence:
    """Load the text behind the hits: artifact bodies for distillations, node text for
    blocks (a container hit, as in an addressed query, contributes its leaves)."""
    evidence = Evidence()
    distillations = passages = 0
    for group in response.groups:
        doc = group.document
        artifact_ids = [h.artifact_id for h in group.hits if h.artifact_id is not None]
        artifacts = {
            a.id: a
            for a in session.exec(select(Artifact).where(col(Artifact.id).in_(artifact_ids)))
        }
        block_anchors = [h.anchor for h in group.hits if h.kind == "block" and h.anchor]
        nodes = _passages(session, doc.id, block_anchors)
        for hit in group.hits:
            artifact = artifacts.get(hit.artifact_id) if hit.artifact_id else None
            if artifact is not None and distillations < MAX_DISTILLATIONS:
                distillations += 1
                label = qualify(doc.slug, artifact.anchor) if artifact.anchor else doc.slug
                text = cited_text(artifact.body, doc.slug)[:DISTILLATION_CHARS]
                evidence.items.append(
                    EvidenceItem(
                        "distillation", doc, artifact.anchor, label, artifact.type.value, text
                    )
                )
                if artifact.anchor:
                    evidence.allow(doc, artifact.anchor)
                for anchor in artifact.citations or []:
                    evidence.allow(doc, anchor)
                for span in leaf_spans(body_blocks(artifact.body)):
                    for cite in span["cites"]:
                        evidence.allow(doc, cite)
                continue
            node = nodes.get(hit.anchor or "")
            if node is None or passages >= MAX_PASSAGES:
                continue
            leaves = (
                _leaves_under(session, doc.id, node.anchor) if node.kind.is_container else [node]
            )
            for leaf in leaves[: MAX_PASSAGES - passages]:
                _add_passage(evidence, doc, leaf)
                passages += 1
    return evidence

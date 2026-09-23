"""Labels and evidence passages for graph refs, across documents, in a few queries.

"Every edge in the UI is clickable through to its evidence passages" (§11): a qualified
anchor `<document_id>#<anchor>` becomes the passage a reader lands on — document title and
slug, the nearest heading, a text snippet — and every endpoint gets a display label.
Anchors are hierarchical (`ch03/s02/p014` lives under `ch03/s02` under `ch03`), so the
nearest heading is found among the anchor's prefixes, in the same query as the passage.
"""

import uuid
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass

from sqlalchemy import tuple_
from sqlmodel import Session, col, select

from app.graph.refs import Ref, split_anchor
from app.models import Artifact, Concept, Document, Node
from app.models.enums import EntityKind

SNIPPET_CHARS = 240
LABEL_CHARS = 80


@dataclass(frozen=True, slots=True)
class DocInfo:
    id: uuid.UUID
    slug: str
    title: str
    authors: list[str]


@dataclass(frozen=True, slots=True)
class Passage:
    ref: str
    document: DocInfo | None
    anchor: str
    kind: str | None
    heading: str | None
    snippet: str | None
    exists: bool  # False: the anchor vanished (re-parse) or the document is gone


@dataclass(frozen=True, slots=True)
class Label:
    kind: EntityKind
    label: str
    sublabel: str | None = None
    document: DocInfo | None = None
    anchor: str | None = None
    blurb: str | None = None


def clip(text: str | None, limit: int) -> str | None:
    if text is None:
        return None
    flat = " ".join(text.split())
    return flat if len(flat) <= limit else flat[: limit - 1].rstrip() + "…"


def _prefixes(anchor: str) -> list[str]:
    parts = anchor.split("/")
    return ["/".join(parts[:i]) for i in range(1, len(parts) + 1)]


def documents(session: Session, ids: Iterable[uuid.UUID]) -> dict[uuid.UUID, DocInfo]:
    wanted = set(ids)
    if not wanted:
        return {}
    rows = session.exec(select(Document).where(col(Document.id).in_(wanted))).all()
    return {d.id: DocInfo(d.id, d.slug, d.title, list(d.authors)) for d in rows}


def passages(session: Session, refs: Iterable[str]) -> dict[str, Passage]:
    """Qualified anchor → its passage. Malformed refs are left out."""
    parsed = {ref: parts for ref in dict.fromkeys(refs) if (parts := split_anchor(ref))}
    if not parsed:
        return {}
    keys = {(doc, prefix) for doc, anchor in parsed.values() for prefix in _prefixes(anchor)}
    rows = session.exec(
        select(Node).where(tuple_(col(Node.document_id), col(Node.anchor)).in_(sorted(keys)))
    ).all()
    nodes = {(n.document_id, n.anchor): n for n in rows}
    docs = documents(session, {doc for doc, _ in parsed.values()})
    out: dict[str, Passage] = {}
    for ref, (doc, anchor) in parsed.items():
        node = nodes.get((doc, anchor))
        heading = next(
            (
                h
                for p in reversed(_prefixes(anchor))
                if (h := getattr(nodes.get((doc, p)), "heading", None))
            ),
            None,
        )
        out[ref] = Passage(
            ref=ref,
            document=docs.get(doc),
            anchor=anchor,
            kind=node.kind.value if node is not None else None,
            heading=heading,
            snippet=clip(node.text, SNIPPET_CHARS) if node is not None else None,
            exists=node is not None and doc in docs,
        )
    return out


def labels(session: Session, refs: Iterable[Ref]) -> dict[Ref, Label]:
    """A display label for every endpoint, whatever its kind."""
    by_kind: dict[EntityKind, list[Ref]] = defaultdict(list)
    for ref in dict.fromkeys(refs):
        by_kind[ref.kind].append(ref)
    out: dict[Ref, Label] = {}

    concept_ids = [r.uuid for r in by_kind[EntityKind.CONCEPT]]
    for c in session.exec(select(Concept).where(col(Concept.id).in_(concept_ids))).all():
        out[Ref.concept(c.id)] = Label(EntityKind.CONCEPT, c.canonical, c.kind.value, blurb=c.blurb)

    artifact_rows = session.exec(
        select(Artifact).where(col(Artifact.id).in_([r.uuid for r in by_kind[EntityKind.ARTIFACT]]))
    ).all()
    doc_ids = {r.uuid for r in by_kind[EntityKind.DOCUMENT]} | {
        a.document_id for a in artifact_rows
    }
    docs = documents(session, doc_ids)
    for ref in by_kind[EntityKind.DOCUMENT]:
        if (doc := docs.get(ref.uuid)) is not None:
            out[ref] = Label(EntityKind.DOCUMENT, doc.title, ", ".join(doc.authors) or None, doc)
    for a in artifact_rows:
        doc = docs.get(a.document_id)
        scope = a.anchor or "whole document"
        sub = f"{doc.title} · {scope}" if doc else scope
        out[Ref(EntityKind.ARTIFACT, str(a.id))] = Label(
            EntityKind.ARTIFACT, a.type.value.replace("_", " "), sub, doc, a.anchor
        )

    found = passages(session, [r.id for r in by_kind[EntityKind.NODE]])
    for ref in by_kind[EntityKind.NODE]:
        passage = found.get(ref.id)
        if passage is None or not passage.exists:
            continue
        is_heading = passage.snippet is None
        title = passage.heading if is_heading else passage.snippet
        parts = [passage.document.title if passage.document else None]
        parts += [passage.heading] if not is_heading else []
        node_sub = " · ".join(p for p in parts if p) or None
        out[ref] = Label(
            EntityKind.NODE,
            clip(title, LABEL_CHARS) or passage.anchor,
            node_sub,
            passage.document,
            passage.anchor,
        )
    return out

"""Builders for the idea-graph tests: two small books, concept_links bodies, a table embedder.

Everything is seeded straight into the database; nothing runs the parser or the CLI.
"""

import uuid
from collections.abc import Callable, Sequence
from typing import Any

import pytest
from sqlmodel import Session, select

from app.models import Artifact, Concept, Document, Edge, Node
from app.models.enums import (
    ArtifactType,
    ConceptKind,
    DocumentKind,
    DocumentStatus,
    NodeKind,
    Origin,
    Review,
)

# (anchor, kind, heading-or-text). Parents follow from the anchor path.
QUEUEING = [
    ("ch01", NodeKind.CHAPTER, "Queues"),
    ("ch01/p001", NodeKind.PARAGRAPH, "Little's law: items equal arrival rate times time."),
    ("ch01/p002", NodeKind.PARAGRAPH, "Limiting work in progress shortens cycle time."),
    ("ch01/f001", NodeKind.FIGURE, "Figure 1.1 Stocks and flows"),
    ("ch02", NodeKind.CHAPTER, "Flow"),
    ("ch02/s01", NodeKind.SECTION, "Flow efficiency"),
    ("ch02/s01/p001", NodeKind.PARAGRAPH, "Flow efficiency is the share of time spent working."),
]
SYSTEMS = [
    ("ch01", NodeKind.CHAPTER, "Stocks"),
    ("ch01/p001", NodeKind.PARAGRAPH, "A stock is the memory of the history of flows."),
    ("ch01/p002", NodeKind.PARAGRAPH, "Little's law holds for any stable stock."),
]


def add_book(
    session: Session,
    slug: str,
    spec: Sequence[tuple[str, NodeKind, str]],
    status: DocumentStatus = DocumentStatus.INDEXED,
) -> Document:
    doc = Document(
        kind=DocumentKind.PDF,
        slug=slug,
        title=slug.replace("-", " ").title(),
        authors=["A. Author"],
        sha256=uuid.uuid4().hex * 2,
        status=status,
        source_path=f"library/{slug}.pdf",
    )
    session.add(doc)
    session.flush()
    nodes: dict[str, Node] = {}
    for ordinal, (anchor, kind, content) in enumerate(spec):
        parent = nodes.get(anchor.rsplit("/", 1)[0]) if "/" in anchor else None
        node = Node(
            document_id=doc.id,
            parent_id=parent.id if parent else None,
            anchor=anchor,
            kind=kind,
            ordinal=ordinal,
            depth=anchor.count("/"),
            heading=content if kind.is_container else None,
            text=None if kind.is_container else content,
        )
        session.add(node)
        session.flush()
        nodes[anchor] = node
    session.commit()
    session.refresh(doc)
    return doc


@pytest.fixture
def queueing(session: Session) -> Document:
    return add_book(session, "okafor-queueing", QUEUEING)


@pytest.fixture
def systems(session: Session) -> Document:
    return add_book(session, "meadows-systems", SYSTEMS)


# --- concept_links bodies ------------------------------------------------------------------


def concept(
    canonical: str, *cites: str, kind: str = "concept", aliases: Sequence[str] = ()
) -> dict[str, Any]:
    return {
        "canonical": canonical,
        "aliases": list(aliases),
        "kind": kind,
        "blurb": [{"text": f"What {canonical} means.", "cites": list(cites)}],
    }


def c(name: str) -> dict[str, str]:
    return {"kind": "concept", "ref": name}


def n(anchor: str) -> dict[str, str]:
    return {"kind": "node", "ref": anchor}


def edge(
    src: dict[str, str], relation: str, dst: dict[str, str], *evidence: str, weight: float = 1.0
) -> dict[str, Any]:
    return {
        "src": src,
        "dst": dst,
        "relation": relation,
        "weight": weight,
        "evidence": list(evidence),
    }


def links(concepts: Sequence[dict[str, Any]], edges: Sequence[dict[str, Any]]) -> dict[str, Any]:
    return {"concepts": list(concepts), "edges": list(edges)}


def store(
    session: Session,
    doc: Document,
    body: dict[str, Any],
    *,
    review: Review = Review.DRAFT,
    type: ArtifactType = ArtifactType.CONCEPT_LINKS,
    anchor: str | None = None,
    version: int = 1,
) -> Artifact:
    artifact = Artifact(
        document_id=doc.id,
        anchor=anchor,
        type=type,
        version=version,
        origin=Origin.SKILL,
        skill="link-concepts",
        skill_version="1",
        input_hash=uuid.uuid4().hex,
        body=body,
        review=review,
    )
    session.add(artifact)
    session.commit()
    session.refresh(artifact)
    return artifact


# --- reads -------------------------------------------------------------------------------------


def concept_named(session: Session, canonical: str) -> Concept:
    return session.exec(select(Concept).where(Concept.canonical == canonical)).one()


def edges_of(session: Session) -> list[Edge]:
    return list(session.exec(select(Edge)).all())


def relations(session: Session) -> set[tuple[str, str, str, str]]:
    """(src label, relation, dst label, status) for every edge; concepts by canonical."""
    names = {str(x.id): x.canonical for x in session.exec(select(Concept)).all()}
    return {
        (
            names.get(e.src_id, e.src_id.split("#")[-1]),
            e.relation.value,
            names.get(e.dst_id, e.dst_id.split("#")[-1]),
            e.status.value,
        )
        for e in edges_of(session)
    }


class TableEmbedder:
    """Dense vectors chosen per concept name, so a test sets similarities exactly."""

    def __init__(self, vectors: dict[str, list[float]]) -> None:
        self.vectors = vectors
        self.calls: list[str] = []

    def dense(self, texts: Sequence[str]) -> list[list[float]]:
        self.calls.extend(texts)
        return [self._lookup(t) for t in texts]

    def _lookup(self, text: str) -> list[float]:
        name = text.split(".")[0]
        return self.vectors.get(name, [0.0, 0.0, 1.0])


MakeConcept = Callable[..., Concept]


@pytest.fixture
def make_concept(session: Session) -> MakeConcept:
    def make(
        canonical: str,
        *,
        aliases: Sequence[str] = (),
        blurb: str | None = None,
        cites: Sequence[str] = (),
    ) -> Concept:
        row = Concept(
            canonical=canonical,
            aliases=list(aliases),
            kind=ConceptKind.CONCEPT,
            blurb=blurb,
            blurb_cites=list(cites),
        )
        session.add(row)
        session.commit()
        session.refresh(row)
        return row

    return make

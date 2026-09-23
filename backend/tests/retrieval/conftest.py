"""Fixtures for retrieval: an in-memory Qdrant, the fake embedder, and a two-book shelf.

Nothing here downloads a model or opens a socket: Qdrant runs in-process
(`QdrantClient(":memory:")`, installed through the client seam) and `FakeEmbedder`
produces hashed bag-of-words vectors, so texts that share words are near each other.
"""

from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any

import pytest
from qdrant_client import QdrantClient
from sqlmodel import Session

from app.models import Artifact, Document, Node
from app.models.enums import ArtifactType, NodeKind, Review
from app.retrieval.client import set_client
from app.retrieval.collections import ensure_collections
from app.retrieval.embedding import FakeEmbedder, set_embedder
from tests.api.factories import make_artifact, make_document, make_node


@pytest.fixture
def qdrant() -> Iterator[QdrantClient]:
    client = QdrantClient(":memory:")
    set_client(client)
    yield client
    set_client(None)
    client.close()


@pytest.fixture
def embedder() -> Iterator[FakeEmbedder]:
    fake = FakeEmbedder()
    set_embedder(fake)
    yield fake
    set_embedder(None)


@pytest.fixture
def collections(qdrant: QdrantClient, embedder: FakeEmbedder) -> QdrantClient:
    ensure_collections(dense_dim=embedder.dense_dim, client=qdrant)
    return qdrant


def para(text: str, *cites: str) -> dict[str, Any]:
    return {"type": "paragraph", "spans": [{"text": text, "cites": list(cites)}]}


@dataclass
class Shelf:
    meadows: Document
    senge: Document
    nodes: dict[str, Node]
    distillation: Artifact  # Meadows ch02, approved
    draft: Artifact  # Meadows ch01 summary, still a draft


def _chapter(session: Session, doc: Document, number: int, heading: str) -> Node:
    return make_node(
        session, doc, f"ch{number:02d}", NodeKind.CHAPTER, ordinal=number, heading=heading
    )


def _leaf(session: Session, doc: Document, parent: Node, anchor: str, text: str) -> Node:
    ordinal = int(anchor[-3:])
    return make_node(
        session, doc, anchor, NodeKind.PARAGRAPH, parent=parent, ordinal=ordinal, text=text
    )


def build_shelf(session: Session) -> Shelf:
    meadows = make_document(
        session,
        slug="meadows-systems",
        title="Thinking in Systems",
        authors=["Donella Meadows"],
        tags=["systems"],
    )
    senge = make_document(
        session,
        slug="senge-fifth-discipline",
        title="The Fifth Discipline",
        authors=["Peter Senge"],
        tags=["management"],
    )
    nodes: dict[str, Node] = {}
    ch1 = _chapter(session, meadows, 1, "The Basics")
    s1 = make_node(session, meadows, "ch01/s01", NodeKind.SECTION, parent=ch1, heading="Stocks")
    nodes["m1"] = _leaf(session, meadows, s1, "ch01/s01/p001", "A stock is the memory of flows.")
    nodes["m2"] = _leaf(
        session, meadows, s1, "ch01/s01/p002", "A bathtub fills when inflow exceeds outflow."
    )
    ch2 = _chapter(session, meadows, 2, "Feedback Loops")
    nodes["m3"] = _leaf(
        session, meadows, ch2, "ch02/p001", "A balancing feedback loop seeks a goal."
    )
    nodes["m4"] = _leaf(
        session, meadows, ch2, "ch02/p002", "Reinforcing loops amplify growth like interest."
    )
    sch1 = _chapter(session, senge, 1, "Learning Organizations")
    nodes["s1"] = _leaf(
        session, senge, sch1, "ch01/p001", "Learning organizations expand their capacity."
    )
    sch2 = _chapter(session, senge, 2, "Systems Thinking")
    nodes["s2"] = _leaf(
        session, senge, sch2, "ch02/p001", "Feedback loops explain delays in organizations."
    )
    distillation = make_artifact(
        session,
        meadows,
        anchor="ch02",
        type=ArtifactType.CHAPTER_DISTILLATION,
        body={"blocks": [para("Balancing feedback loops stabilize a stock.", "ch02/p001")]},
    )
    make_artifact(
        session,
        senge,
        anchor="ch02",
        type=ArtifactType.CHAPTER_DISTILLATION,
        body={"blocks": [para("Feedback loops cause delays and oscillation.", "ch02/p001")]},
    )
    draft = make_artifact(
        session,
        meadows,
        anchor="ch01",
        type=ArtifactType.CHAPTER_SUMMARY,
        body={"blocks": [para("Stocks accumulate flows over time.", "ch01/s01/p001")]},
        review=Review.DRAFT,
    )
    return Shelf(meadows, senge, nodes, distillation, draft)


@pytest.fixture
def shelf(session: Session) -> Shelf:
    return build_shelf(session)

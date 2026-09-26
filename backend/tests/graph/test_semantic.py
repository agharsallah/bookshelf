"""Semantic links from Qdrant: echoing chapters and paraphrasing passages.

Qdrant runs in-process and `FakeEmbedder` makes texts that share words near each other,
so the tests set the thresholds (`Tuning`) for the fake's scale, not bge-small's.
"""

import uuid
from collections.abc import Iterator
from dataclasses import replace

import pytest
from qdrant_client import QdrantClient
from sqlmodel import Session, select

from app.graph import semantic
from app.models import Concept, Document, Edge
from app.models.enums import NodeKind, Relation
from app.retrieval.client import set_client
from app.retrieval.collections import ensure_collections
from app.retrieval.embedding import FakeEmbedder, set_embedder
from app.retrieval.indexing import delete_document, index_document
from tests.graph.conftest import MakeConcept, add_book

QUEUE = (
    "Queues grow without bound whenever arrivals outpace service; the only lasting cure is "
    "limiting work in progress so waiting time shrinks and flow returns to the system."
)
QUEUE_AGAIN = (
    "Whenever arrivals outpace service queues grow without bound; limiting work in progress "
    "is the lasting cure, so waiting time shrinks and flow returns to the whole system."
)
QUEUE_THIRD = (
    "Arrivals outpacing service make queues grow; limiting work in progress shrinks waiting "
    "time, the lasting cure that lets flow return to the system without bound or delay."
)
STORY = (
    "A good interview story opens with the situation, names the task you owned, walks through "
    "the actions you chose and closes on a result the listener can measure and remember."
)
GARDEN = (
    "Tomatoes want full sun, deep watering twice a week, and a stake before the first truss "
    "sets; pinch the side shoots so the plant spends its strength on fruit and not on leaves."
)

FLOW = [
    ("ch01", NodeKind.CHAPTER, "Queues"),
    ("ch01/p001", NodeKind.PARAGRAPH, QUEUE),
    ("ch01/p002", NodeKind.PARAGRAPH, QUEUE_THIRD),
    ("ch02", NodeKind.CHAPTER, "Gardens"),
    ("ch02/p001", NodeKind.PARAGRAPH, GARDEN),
    ("ch02/p002", NodeKind.PARAGRAPH, "Short line."),
]
TALKS = [
    ("ch01", NodeKind.CHAPTER, "Lines"),
    ("ch01/p001", NodeKind.PARAGRAPH, QUEUE_AGAIN),
    ("ch01/p002", NodeKind.PARAGRAPH, QUEUE_THIRD + " Again."),
    ("ch02", NodeKind.CHAPTER, "Stories"),
    ("ch02/p001", NodeKind.PARAGRAPH, STORY),
]
TUNING = semantic.Tuning(
    echo_floor=0.6, echo_percentile=0.0, min_echoes=2, paraphrase_floor=0.3, paraphrase_gap=0.2
)


@pytest.fixture
def qdrant() -> Iterator[tuple[QdrantClient, FakeEmbedder]]:
    client, fake = QdrantClient(":memory:"), FakeEmbedder()
    set_client(client)
    set_embedder(fake)
    ensure_collections(dense_dim=fake.dense_dim, client=client)
    yield client, fake
    set_client(None)
    set_embedder(None)
    client.close()


def shelf(session: Session, qdrant: tuple[QdrantClient, FakeEmbedder]) -> tuple[Document, Document]:
    client, fake = qdrant
    flow, talks = add_book(session, "flow", FLOW), add_book(session, "talks", TALKS)
    for doc in (flow, talks):
        index_document(session, doc, embedder=fake, client=client)
    return flow, talks


def edges(session: Session, relation: Relation) -> list[Edge]:
    return list(session.exec(select(Edge).where(Edge.relation == relation)).all())


def test_chapters_that_say_the_same_thing_echo_across_books(session, qdrant):
    flow, talks = shelf(session, qdrant)
    client, fake = qdrant

    report = semantic.sync(session, client, fake, tuning=TUNING)
    semantic.sync(session, client, fake, tuning=TUNING)  # idempotent

    (echo,) = edges(session, Relation.ECHOES)
    assert {echo.src_id, echo.dst_id} == {f"{flow.id}#ch01", f"{talks.id}#ch01"}
    assert echo.origin == semantic.SEMANTIC_ORIGIN
    assert set(echo.evidence) <= {
        f"{flow.id}#ch01/p001",
        f"{flow.id}#ch01/p002",
        f"{talks.id}#ch01/p001",
        f"{talks.id}#ch01/p002",
    }
    assert echo.meta["pairs"] >= 2
    assert report.echoes == 1 and report.threshold == pytest.approx(0.6)


def test_one_echoing_pair_is_not_enough(session, qdrant):
    shelf(session, qdrant)
    client, fake = qdrant

    semantic.sync(session, client, fake, tuning=replace(TUNING, min_echoes=9))

    assert edges(session, Relation.ECHOES) == []


def test_a_passage_that_explains_a_concept_without_naming_it_mentions_it(
    session, qdrant, make_concept: MakeConcept
):
    _, talks = shelf(session, qdrant)
    client, fake = qdrant
    make_concept(
        "star method", blurb="Situation, task, actions you chose, and a measurable result."
    )

    semantic.sync(session, client, fake, tuning=TUNING)

    star = session.exec(select(Concept).where(Concept.canonical == "star method")).one()
    found = [e for e in edges(session, Relation.MENTIONS) if e.dst_id == str(star.id)]
    assert [e.src_id for e in found] == [f"{talks.id}#ch02/p001"]
    assert found[0].meta["via"] == "paraphrase"


def test_links_that_stop_holding_are_withdrawn(session, qdrant):
    flow, _ = shelf(session, qdrant)
    client, fake = qdrant
    semantic.sync(session, client, fake, tuning=TUNING)
    assert edges(session, Relation.ECHOES)

    delete_document(client, str(flow.id))
    report = semantic.sync(session, client, fake, tuning=TUNING)

    assert edges(session, Relation.ECHOES) == []
    assert report.removed == 1


def test_the_bar_is_the_shelfs_own_percentile_never_below_the_floor():
    a = semantic.Block(document_id=uuid.uuid4(), anchor="ch01/p001", chapter="ch01")
    pairs = [semantic._Pair(a, a, s) for s in (0.70, 0.80, 0.90, 0.95)]
    assert (
        semantic.echo_threshold(pairs, semantic.Tuning(echo_floor=0.5, echo_percentile=0.5)) == 0.9
    )
    assert semantic.echo_threshold(pairs, semantic.Tuning(echo_floor=0.99)) == 0.99
    assert semantic.echo_threshold([], semantic.Tuning()) == semantic.Tuning().echo_floor

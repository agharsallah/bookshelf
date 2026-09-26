"""Bridges: cross-book concept pairs judged by `relate-concepts`, proposed and never accepted."""

import json

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import get_settings
from app.graph import apply, bridges
from app.graph.pipeline import BRIDGE_MODE, is_bridge_job, refresh_document
from app.models import Document, Edge, Job
from app.models.enums import EdgeStatus, Relation
from app.pipeline.runner import FakeRunner
from tests.conftest import AUTH
from tests.graph.conftest import TableEmbedder, c, concept, concept_named, edge, links, n, store

# queueing: little's law (ch01/p001), wip limit (ch01/p002); systems: stock (ch01/p001)
VECTORS = {
    "little's law": [1.0, 0.0, 0.0],
    "stock": [0.8, 0.6, 0.0],  # cosine 0.8 with little's law: a bridge candidate
    "wip limit": [0.0, 0.0, 1.0],  # unrelated to both
}
CONTRADICTS = json.dumps(
    {
        "relation": "contradicts",
        "direction": "b_to_a",
        "confidence": "medium",
        "rationale": "B1 says stocks remember; A1 says only rates matter.",
        "evidence": ["A1", "B1"],
    }
)
NONE = json.dumps(
    {
        "relation": "none",
        "direction": "a_to_b",
        "confidence": "high",
        "rationale": "Topic only.",
        "evidence": [],
    }
)
ONE_SIDED = json.dumps({**json.loads(CONTRADICTS), "evidence": ["A1"]})


@pytest.fixture
def shelf(session: Session, queueing: Document, systems: Document) -> None:
    apply.apply(
        session,
        store(
            session,
            queueing,
            links(
                [concept("little's law", "ch01/p001"), concept("wip limit", "ch01/p002")],
                [
                    edge(n("ch01/p001"), "defines", c("little's law"), "ch01/p001"),
                    edge(n("ch01/p002"), "defines", c("wip limit"), "ch01/p002"),
                ],
            ),
        ),
    )
    apply.apply(
        session,
        store(
            session,
            systems,
            links(
                [concept("stock", "ch01/p001")],
                [edge(n("ch01/p001"), "defines", c("stock"), "ch01/p001")],
            ),
        ),
    )


def run(session: Session, runner: FakeRunner, **kw) -> list[bridges.Verdict]:
    return bridges.run_bridges(
        session,
        runner=runner,
        embedder=TableEmbedder(VECTORS),
        skills_dir=get_settings().skills_dir,
        threshold=kw.pop("threshold", 0.6),
        ceiling=kw.pop("ceiling", 0.88),
        limit=10,
        **kw,
    )


def proposals(session: Session) -> list[Edge]:
    return list(
        session.exec(select(Edge).where(Edge.origin.startswith("skill:relate-concepts"))).all()
    )


def test_a_relation_becomes_a_proposed_edge_citing_both_books(session, shelf, queueing, systems):
    runner = FakeRunner(CONTRADICTS)

    [verdict] = run(session, runner)

    (bridge,) = proposals(session)
    law, stock = concept_named(session, "little's law"), concept_named(session, "stock")
    a_is_law = verdict.a == str(law.id)
    # b_to_a: "b contradicts a", whichever side the pair put each concept on
    assert (bridge.src_id, bridge.dst_id) == (
        (str(stock.id), str(law.id)) if a_is_law else (str(law.id), str(stock.id))
    )
    assert (bridge.relation, bridge.status, bridge.weight) == (
        Relation.CONTRADICTS,
        EdgeStatus.PROPOSED,
        0.6,
    )
    assert {ref.split("#")[0] for ref in bridge.evidence} == {str(queueing.id), str(systems.id)}
    assert bridge.meta["rationale"].startswith("B1 says")
    prompt = runner.calls[0]["prompt"]
    assert "Little's law: items equal arrival rate times time." in prompt
    assert "A stock is the memory of the history of flows." in prompt
    assert runner.calls[0]["tier"].value == "reason"


def test_none_is_remembered_as_rejected_and_never_asked_again(session, shelf):
    runner = FakeRunner(NONE)

    run(session, runner)
    run(session, runner)

    (judged,) = proposals(session)
    assert judged.status is EdgeStatus.REJECTED and judged.meta["verdict"] == "none"
    assert len(runner.calls) == 1


def test_a_relation_that_cites_one_book_only_is_sent_back(session, shelf):
    runner = FakeRunner(ONE_SIDED, CONTRADICTS)

    run(session, runner)

    assert len(runner.calls) == 2
    assert "evidence from both sides" in runner.calls[1]["prompt"]


def test_only_cross_book_pairs_in_the_band_are_nominated(session, shelf):
    assert run(session, FakeRunner(NONE), threshold=0.9) == []  # below the bar
    assert run(session, FakeRunner(NONE), ceiling=0.7) == []  # a merge question, not a bridge
    # wip limit and little's law share a book: never a bridge, whatever their similarity
    pairs = bridges.candidates(
        session,
        embedder=TableEmbedder({**VECTORS, "wip limit": [1.0, 0.0, 0.0]}),
        threshold=0.0,
        ceiling=1.01,
        limit=10,
    )
    names = {frozenset((p.a.canonical, p.b.canonical)) for p in pairs}
    assert frozenset(("little's law", "wip limit")) not in names


def test_new_concepts_queue_a_bridge_job_and_the_endpoint_queues_one_per_book(
    session, client: TestClient, queueing, systems
):
    store(
        session,
        queueing,
        links(
            [concept("little's law", "ch01/p001")],
            [edge(n("ch01/p001"), "defines", c("little's law"), "ch01/p001")],
        ),
    )
    specs = refresh_document(session, queueing.id)
    assert [s.payload for s in specs if s.payload and s.payload.get("mode") == BRIDGE_MODE] == [
        {"mode": BRIDGE_MODE}
    ]

    response = client.post("/api/v1/graph/bridges", json={}, headers=AUTH)

    assert response.status_code == 202
    jobs = [session.get(Job, j) for j in response.json()["jobs"]]
    assert {j.document_id for j in jobs if j} == {queueing.id, systems.id}
    assert all(j and is_bridge_job(j) for j in jobs)
    assert client.post("/api/v1/graph/bridges", json={}).status_code == 401

"""Synthesis brings the idea graph: accepted concept relations between the result books."""

import json

from sqlmodel import Session

from app.models import Concept, Edge, node_ref
from app.models.enums import ConceptKind, EdgeStatus, EntityKind, Relation
from app.pipeline.runner import FakeRunner
from app.retrieval import answer, search
from app.retrieval.embedding import FakeEmbedder
from app.retrieval.router import QueryRouter
from app.schemas.search import SearchRequest
from tests.retrieval.conftest import Shelf, para

QUERY = "compare Meadows and Senge on feedback loops"


def concept(session: Session, name: str) -> Concept:
    row = Concept(canonical=name, kind=ConceptKind.CONCEPT)
    session.add(row)
    session.commit()
    return row


def relate(session: Session, src: Concept, relation: Relation, dst: Concept, *evidence: str,
           status: EdgeStatus = EdgeStatus.ACCEPTED) -> None:  # fmt: skip
    session.add(Edge(
        src_kind=EntityKind.CONCEPT, src_id=str(src.id), dst_kind=EntityKind.CONCEPT,
        dst_id=str(dst.id), relation=relation, evidence=list(evidence), origin="human",
        status=status,
    ))  # fmt: skip
    session.commit()


def graph(session: Session, shelf: Shelf) -> None:
    loops, delays, growth = (concept(session, n) for n in ("feedback loop", "delay", "growth"))
    meadows, senge = node_ref(shelf.meadows.id, "ch02/p001"), node_ref(shelf.senge.id, "ch02/p001")
    relate(session, loops, Relation.SUPPORTS, growth, meadows)
    relate(session, loops, Relation.CONTRADICTS, delays, meadows, senge)
    relate(session, delays, Relation.EXTENDS, growth, meadows, status=EdgeStatus.PROPOSED)
    relate(session, growth, Relation.MENTIONS, loops, senge)


def test_synthesis_returns_accepted_relations_contradictions_first(
    session: Session, indexed: Shelf, embedder: FakeEmbedder
):
    graph(session, indexed)

    response = search.run(
        session, SearchRequest(query=QUERY), router=QueryRouter(), embedder=embedder
    ).response

    assert [(r.src.canonical, r.relation, r.dst.canonical) for r in response.relations] == [
        ("feedback loop", "contradicts", "delay"),
        ("feedback loop", "supports", "growth"),
    ]
    assert response.relations[0].evidence == [
        "meadows-systems:ch02/p001", "senge-fifth-discipline:ch02/p001",
    ]  # fmt: skip


def test_discovery_carries_no_relations(session: Session, indexed: Shelf, embedder: FakeEmbedder):
    graph(session, indexed)

    request = SearchRequest(query="what about feedback loops?")
    response = search.run(session, request, router=QueryRouter(), embedder=embedder).response

    assert response.intent == "discovery" and response.relations == []


def test_the_answer_prompt_lists_the_relations(
    session: Session, indexed: Shelf, embedder: FakeEmbedder
):
    graph(session, indexed)
    runner = FakeRunner(
        json.dumps({"blocks": [para("They disagree.", "meadows-systems:ch02/p001")]})
    )

    events = list(answer.stream(session, SearchRequest(query=QUERY), router=QueryRouter(),
                                embedder=embedder, runner=runner))  # fmt: skip

    assert events[-1][0] == "answer"
    assert (
        "- feedback loop CONTRADICTS delay (evidence: meadows-systems:ch02/p001"
        in (runner.calls[0]["prompt"])
    )

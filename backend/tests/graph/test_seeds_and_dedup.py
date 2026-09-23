"""Diagram seed edges, and dedup that proposes merges but never makes them."""

import json

from sqlmodel import Session, select

from app.core.config import get_settings
from app.graph import dedup, diagram_seeds
from app.models import Concept, Document, Edge
from app.models.enums import ArtifactType, EdgeStatus, Relation, Review
from app.pipeline.runner import FakeRunner
from tests.graph.conftest import MakeConcept, TableEmbedder, relations, store

DIAGRAM = {
    "kind": "diagram",
    "caption": "Stocks and flows",
    "alt": "Arrows",
    "confidence": "high",
    "takeaway": {"text": "Flows fill stocks.", "cites": ["ch01/f001"]},
    "blocks": [
        {
            "type": "diagram",
            "cites": ["ch01/f001"],
            "nodes": [
                {"id": "a", "label": "Flows"},
                {"id": "b", "label": "Stock"},
                {"id": "c", "label": "Rainfall"},
            ],
            "edges": [{"from": "a", "to": "b"}, {"from": "c", "to": "b"}],
        }
    ],
}


def figure(session: Session, doc: Document, review: Review = Review.DRAFT) -> None:
    store(
        session,
        doc,
        DIAGRAM,
        type=ArtifactType.FIGURE_DESCRIPTION,
        anchor="ch01/f001",
        review=review,
    )


def test_matching_diagram_labels_become_mentions_and_proposed_supports(
    session, queueing, make_concept: MakeConcept
):
    make_concept("flow")
    make_concept("stock")
    figure(session, queueing)

    diagram_seeds.seed_document(session, queueing.id)
    diagram_seeds.seed_document(session, queueing.id)  # idempotent

    assert relations(session) == {
        ("ch01/f001", "mentions", "flow", "accepted"),
        ("ch01/f001", "mentions", "stock", "accepted"),
        ("flow", "supports", "stock", "proposed"),
    }
    assert {tuple(e.evidence) for e in session.exec(select(Edge)).all()} == {
        (f"{queueing.id}#ch01/f001",)
    }


def test_a_figure_waiting_for_review_seeds_nothing(session, queueing, make_concept: MakeConcept):
    make_concept("stock")
    figure(session, queueing, Review.NEEDS_REVIEW)

    diagram_seeds.seed_document(session, queueing.id)

    assert relations(session) == set()


VERDICT_SAME = json.dumps(
    {"same": True, "confidence": "high", "rationale": "Same cap.", "survivor": "b"}
)
VERDICT_NOT = json.dumps(
    {"same": False, "confidence": "medium", "rationale": "A part.", "survivor": "a"}
)
VECTORS = {"wip cap": [1.0, 0.0, 0.0], "wip limit": [0.95, 0.31, 0.0], "slack": [0.0, 1.0, 0.0]}


def run(session: Session, ids: list, runner: FakeRunner, threshold: float = 0.88) -> list:
    return dedup.run_dedup(
        session,
        ids,
        runner=runner,
        embedder=TableEmbedder(VECTORS),
        skills_dir=get_settings().skills_dir,
        threshold=threshold,
        limit=10,
    )


def test_a_confirmed_pair_becomes_a_proposed_same_as_and_nothing_is_merged(
    session, make_concept: MakeConcept
):
    new = make_concept("wip cap")
    old = make_concept("wip limit")
    make_concept("slack")
    runner = FakeRunner(VERDICT_SAME)

    [verdict] = run(session, [new.id], runner)

    edge = session.exec(select(Edge)).one()
    assert (edge.src_id, edge.dst_id) == (str(new.id), str(old.id))
    assert (edge.relation, edge.status) == (Relation.SAME_AS, EdgeStatus.PROPOSED)
    assert edge.weight == round(verdict.similarity, 3)
    assert (verdict.rationale, verdict.survivor) == ("Same cap.", str(old.id))
    assert edge.meta == {
        "similarity": round(verdict.similarity, 4),
        "confidence": "high",
        "rationale": "Same cap.",
        "survivor": str(old.id),
    }
    assert all(c.merged_into is None for c in session.exec(select(Concept)).all())
    assert len(runner.calls) == 1
    assert '"canonical": "wip cap"' in runner.calls[0]["prompt"]
    assert runner.calls[0]["tier"].value == "reason"


def test_a_refused_pair_is_remembered_and_never_asked_again(session, make_concept: MakeConcept):
    new = make_concept("wip cap")
    make_concept("wip limit")
    runner = FakeRunner(VERDICT_NOT)

    run(session, [new.id], runner)
    run(session, [new.id], runner)

    assert session.exec(select(Edge.status)).all() == [EdgeStatus.REJECTED]
    assert len(runner.calls) == 1


def test_pairs_below_the_threshold_never_reach_the_model(session, make_concept: MakeConcept):
    new = make_concept("wip cap")
    make_concept("wip limit")  # cosine ≈ 0.95
    runner = FakeRunner(VERDICT_SAME)

    assert run(session, [new.id], runner, threshold=0.96) == []

    assert runner.calls == []
    assert session.exec(select(Edge)).all() == []

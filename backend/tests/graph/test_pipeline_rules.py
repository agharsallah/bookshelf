"""The orchestrator keeps the graph in step with link jobs and reviews; dedup runs as a job."""

import json

import pytest
from sqlmodel import Session, select

from app.jobs import queue
from app.jobs.queue import JobSpec
from app.jobs.registry import JobContext
from app.models import Concept, Document, Edge, Job
from app.models.enums import DocumentStatus, EdgeStatus, JobKind, JobState, Review
from app.pipeline import authoring, orchestrator
from app.pipeline.handlers import skills as skill_handler
from app.pipeline.runner import FakeRunner
from app.retrieval import embedding
from tests.graph.conftest import c, concept, edge, links, n, relations, store

BODY = links(
    [concept("slack", "ch01/p002"), concept("wip limit", "ch01/p002")],
    [edge(n("ch01/p002"), "defines", c("slack"), "ch01/p002")],
)


def link_job(session: Session, doc: Document, artifact_id: object) -> Job:
    job = queue.enqueue(session, JobSpec(kind=JobKind.LINK_CONCEPTS, document_id=doc.id))
    assert job is not None
    queue.complete(session, job, result={"artifact_id": str(artifact_id)})
    return job


def queued_dedup(session: Session) -> list[Job]:
    return [
        j
        for j in session.exec(select(Job).where(Job.state == JobState.QUEUED)).all()
        if j.payload.get("mode") == "dedup"
    ]


def test_a_finished_link_job_applies_its_artifact_and_queues_dedup(session, queueing):
    artifact = store(session, queueing, BODY)

    orchestrator.on_job_done(session, link_job(session, queueing, artifact.id))

    assert relations(session) == {("ch01/p002", "defines", "slack", "accepted")}
    [dedup] = queued_dedup(session)
    created = {str(x.id) for x in session.exec(select(Concept)).all()}
    assert set(dedup.payload["concept_ids"]) == created
    session.refresh(queueing)
    assert queueing.status is DocumentStatus.LINKED


def test_an_artifact_waiting_for_review_stays_out_of_the_graph(session, queueing):
    artifact = store(session, queueing, BODY, review=Review.NEEDS_REVIEW)

    orchestrator.on_job_done(session, link_job(session, queueing, artifact.id))

    assert relations(session) == set()
    assert queued_dedup(session) == []


def test_approving_applies_and_rejecting_withdraws(session, queueing):
    artifact = store(session, queueing, BODY, review=Review.NEEDS_REVIEW)

    authoring.review(session, artifact, "approve")
    assert relations(session) == {("ch01/p002", "defines", "slack", "accepted")}

    authoring.review(session, artifact, "reject")
    assert relations(session) == set()
    assert session.exec(select(Concept)).all() == []


def test_a_finished_dedup_job_advances_nothing(session, queueing):
    job = queue.enqueue(
        session,
        JobSpec(
            kind=JobKind.LINK_CONCEPTS,
            document_id=queueing.id,
            input_hash="h",
            payload={"mode": "dedup"},
        ),
    )
    assert job is not None
    queue.complete(session, job, state=JobState.SKIPPED)

    assert orchestrator.on_job_done(session, job) == []
    session.refresh(queueing)
    assert queueing.status is DocumentStatus.INDEXED


@pytest.fixture
def fakes(monkeypatch: pytest.MonkeyPatch) -> FakeRunner:
    runner = FakeRunner(
        json.dumps({"same": True, "confidence": "high", "rationale": "Twins.", "survivor": "a"})
    )
    monkeypatch.setattr(skill_handler, "_runner", runner)
    embedding.set_embedder(embedding.FakeEmbedder(dim=32))
    yield runner
    embedding.set_embedder(None)


def test_the_link_concepts_handler_runs_dedup_mode_jobs(session, queueing, fakes, make_concept):
    new, old = make_concept("wip limit", blurb="a cap"), make_concept("wip limits", blurb="a cap")
    job = queue.enqueue(
        session,
        JobSpec(
            kind=JobKind.LINK_CONCEPTS,
            document_id=queueing.id,
            input_hash="h",
            payload={"mode": "dedup", "threshold": 0.5, "concept_ids": [str(new.id)]},
        ),
    )
    assert job is not None

    outcome = skill_handler.run_skill(JobContext(session=session, job=job))

    [proposal] = outcome.result["proposals"]
    assert (proposal["rationale"], proposal["survivor"]) == ("Twins.", str(new.id))
    same_as = session.exec(select(Edge)).one()
    assert (same_as.src_id, same_as.dst_id, same_as.status) == (
        str(new.id),
        str(old.id),
        EdgeStatus.PROPOSED,
    )

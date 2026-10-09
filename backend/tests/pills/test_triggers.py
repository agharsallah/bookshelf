"""`harvest_pills` is queued by the pipeline's own entry points and runs as a job."""

import uuid

from sqlmodel import Session, select

from app.jobs.registry import JobContext, get_handler
from app.models import Document, Job
from app.models.enums import ArtifactType, JobKind, JobState, Origin, PillKind, Review
from app.models.pill import Pill
from app.pills.harvest import HARVESTABLE_TYPES, HARVESTERS
from app.pills.triggers import HARVEST_PRIORITY
from app.pipeline import auto_approval, orchestrator
from app.pipeline.handlers import pills as pills_handler  # registers the handler
from app.services import app_settings
from tests.api.factories import make_artifact
from tests.pills.fixtures import example


def harvests(session: Session) -> list[Job]:
    return list(session.exec(select(Job).where(Job.kind == JobKind.HARVEST_PILLS)).all())


def finished(session: Session, document: Document, kind: JobKind, result: dict[str, object]) -> Job:
    job = Job(kind=kind, document_id=document.id, state=JobState.DONE, result=result, payload={})
    session.add(job)
    session.commit()
    session.refresh(job)
    return job


def test_every_harvestable_type_has_a_harvester_and_pill_sets_are_one():
    assert frozenset(HARVESTERS) == HARVESTABLE_TYPES
    assert ArtifactType.PILL_SET in HARVESTABLE_TYPES


def test_a_review_of_a_harvestable_artifact_queues_one_harvest(session: Session, book: Document):
    artifact = make_artifact(
        session, book, type=ArtifactType.QUIZ, anchor="ch03", body=example("make-quiz")
    )

    orchestrator.on_review(session, artifact)
    orchestrator.on_review(session, artifact)

    (job,) = harvests(session)  # deduped while queued
    assert (job.document_id, job.state, job.priority) == (
        book.id,
        JobState.QUEUED,
        HARVEST_PRIORITY,
    )


def test_other_artifacts_queue_no_harvest(session: Session, book: Document):
    artifact = make_artifact(session, book, type=ArtifactType.CHAPTER_SUMMARY, anchor="ch03")

    orchestrator.on_review(session, artifact)

    assert harvests(session) == []


def test_a_rejection_and_a_reopen_queue_a_harvest(session: Session, book: Document):
    artifact = make_artifact(
        session, book, type=ArtifactType.FLASHCARDS, anchor="ch02", review=Review.REJECTED
    )

    orchestrator.on_review(session, artifact)
    assert len(harvests(session)) == 1

    session.delete(harvests(session)[0])
    session.commit()
    orchestrator.on_reopen(session, artifact, was_approved=False)
    assert len(harvests(session)) == 1


def test_auto_approval_queues_a_harvest(session: Session, book: Document):
    app_settings.set_auto_approve(session, "all")
    artifact = make_artifact(
        session,
        book,
        type=ArtifactType.QUIZ,
        anchor="ch03",
        review=Review.DRAFT,
        origin=Origin.SKILL,
    )

    auto_approval.settle(session, artifact)

    assert len(harvests(session)) == 1


def test_a_job_that_stored_a_harvestable_artifact_queues_a_harvest(
    session: Session, book: Document
):
    artifact = make_artifact(session, book, type=ArtifactType.QUOTE_SET, anchor="ch03")
    summary = make_artifact(session, book, type=ArtifactType.CHAPTER_SUMMARY, anchor="ch03")

    orchestrator.on_job_done(
        session, finished(session, book, JobKind.SUMMARIZE, {"artifact_id": str(summary.id)})
    )
    assert harvests(session) == []

    orchestrator.on_job_done(
        session, finished(session, book, JobKind.DERIVE, {"artifact_id": str(artifact.id)})
    )
    assert len(harvests(session)) == 1


def test_a_voiced_script_queues_a_harvest(session: Session, book: Document):
    orchestrator.on_job_done(session, finished(session, book, JobKind.NARRATE, {}))

    assert len(harvests(session)) == 1


def test_the_job_harvests_the_document(session: Session, book: Document):
    make_artifact(session, book, type=ArtifactType.QUIZ, anchor="ch03", body=example("make-quiz"))
    job = finished(session, book, JobKind.HARVEST_PILLS, {})
    handler = get_handler(JobKind.HARVEST_PILLS)

    assert handler is pills_handler.run_harvest_pills
    result = handler(JobContext(session=session, job=job))

    stored = session.exec(select(Pill).where(Pill.document_id == book.id)).all()
    assert result.state is JobState.DONE
    assert result.result["created"] == len(stored) == len(example("make-quiz")["items"])
    assert {p.kind for p in stored} == {PillKind.QUIZ}


def test_the_job_skips_a_document_that_is_gone(session: Session):
    job = Job(kind=JobKind.HARVEST_PILLS, document_id=uuid.uuid4(), payload={})

    result = pills_handler.run_harvest_pills(JobContext(session=session, job=job))

    assert result.state is JobState.SKIPPED

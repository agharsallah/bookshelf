"""§14 run ceiling: pause the document visibly, fail fast while paused, resume."""

from pathlib import Path

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.jobs import queue
from app.jobs.registry import PermanentJobError
from app.models import Document, Job
from app.models.enums import JobKind, JobState
from app.pipeline.execution import execute_skill_job
from app.pipeline.runner import FakeRunner
from tests.conftest import AUTH
from tests.pipeline.runtime.conftest import body, paragraph, reply

GROUNDED = reply(body(paragraph("A stock remembers its flows.", "ch01/s01/p001")))


def attempt(session: Session, job: Job, skills_dir: Path, runner: FakeRunner) -> JobState:
    """What the worker does with one claimed job, at a ceiling of one run."""
    queue.claim(session)
    session.refresh(job)
    try:
        execute_skill_job(session, job, runner=runner, skills_dir=skills_dir, max_runs=1)
    except PermanentJobError as exc:
        queue.fail(session, job, str(exc), retry=False)
    else:
        queue.complete(session, job)
    return job.state


def test_the_ceiling_pauses_the_document_and_every_later_run_fails_fast(
    api: TestClient, session: Session, book: Document, make_job, skills_dir: Path
):
    runner = FakeRunner(GROUNDED)
    attempt(session, make_job(JobKind.SUMMARIZE, book, "ch01"), skills_dir, runner)

    tripped = make_job(JobKind.DISTIL_SECTION, book, "ch01/s01")
    assert attempt(session, tripped, skills_dir, runner) is JobState.FAILED
    later = make_job(JobKind.DISTIL_SECTION, book, "ch01/s02")
    assert attempt(session, later, skills_dir, runner) is JobState.FAILED

    assert len(runner.calls) == 1  # only the first job reached the model
    assert (tripped.error or "").startswith("run ceiling reached")
    paused = api.get(f"/api/v1/documents/{book.slug}").json()["paused"]
    assert (paused["runs"], paused["limit"]) == (1, 1)


def test_resume_clears_the_pause_raises_the_ceiling_and_requeues_the_stopped_jobs(
    api: TestClient, session: Session, book: Document, make_job, skills_dir: Path
):
    runner = FakeRunner(GROUNDED)
    attempt(session, make_job(JobKind.SUMMARIZE, book, "ch01"), skills_dir, runner)
    stopped = make_job(JobKind.DISTIL_SECTION, book, "ch01/s01")
    attempt(session, stopped, skills_dir, runner)

    response = api.post(f"/api/v1/documents/{book.slug}/resume", json={"max_runs": 5}, headers=AUTH)

    assert response.status_code == 200
    resumed = response.json()
    assert resumed["document"]["paused"] is None
    assert resumed["document"]["meta"]["run_ceiling"] == 5
    [again] = resumed["requeued"]
    assert (again["kind"], again["anchor"], again["state"]) == (
        "distil_section",
        "ch01/s01",
        "queued",
    )


def test_resume_without_a_limit_grants_another_full_allowance(
    api: TestClient, session: Session, book: Document, make_job, skills_dir: Path
):
    runner = FakeRunner(GROUNDED)
    attempt(session, make_job(JobKind.SUMMARIZE, book, "ch01"), skills_dir, runner)
    attempt(session, make_job(JobKind.DISTIL_SECTION, book, "ch01/s01"), skills_dir, runner)

    resumed = api.post(f"/api/v1/documents/{book.slug}/resume", headers=AUTH).json()

    # one real run (the ceiling's own failure is not a run) + the default allowance of 400
    assert resumed["document"]["meta"]["run_ceiling"] == 401

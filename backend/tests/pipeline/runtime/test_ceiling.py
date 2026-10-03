"""§14 run ceiling: pause the document visibly, fail fast while paused, resume."""

import threading
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.graph.pipeline import dedup_spec, run_dedup_job
from app.jobs import queue
from app.jobs.registry import PermanentJobError
from app.models import Document, Job
from app.models.enums import JobKind, JobState
from app.pipeline import ceiling
from app.pipeline.execution import SKILL_JOB_KINDS, execute_skill_job
from app.pipeline.runner import FakeRunner, RunnerError, UsageLimitError
from tests.conftest import AUTH
from tests.pipeline.runtime.conftest import body, paragraph, reply

GROUNDED = reply(body(paragraph("A stock remembers its flows.", "ch01/s01/p001")))


def attempt(session: Session, job: Job, skills_dir: Path, runner: FakeRunner) -> JobState:
    """What the worker does with one claimed job, at a ceiling of one run."""
    return attempt_at(session, job, skills_dir, runner, max_runs=1)


def attempt_at(
    session: Session, job: Job, skills_dir: Path, runner: FakeRunner, *, max_runs: int
) -> JobState:
    queue.claim(session)
    session.refresh(job)
    try:
        execute_skill_job(session, job, runner=runner, skills_dir=skills_dir, max_runs=max_runs)
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


def test_every_cli_run_counts_including_the_schema_retry(
    api: TestClient, session: Session, book: Document, make_job, skills_dir: Path
):
    runner = FakeRunner("not json", GROUNDED)  # the first reply fails the schema gate
    first = make_job(JobKind.SUMMARIZE, book, "ch01")
    queue.claim(session)
    session.refresh(first)
    execute_skill_job(session, first, runner=runner, skills_dir=skills_dir, max_runs=2)
    queue.complete(session, first)

    tripped = make_job(JobKind.DISTIL_SECTION, book, "ch01/s01")
    assert attempt_at(session, tripped, skills_dir, runner, max_runs=2) is JobState.FAILED

    assert len(runner.calls) == 2
    paused = api.get(f"/api/v1/documents/{book.slug}").json()["paused"]
    assert (paused["runs"], paused["limit"]) == (2, 2)


def test_runs_of_failed_attempts_count_toward_the_ceiling(
    session: Session, book: Document, make_job, skills_dir: Path
):
    def flaky(prompt: str) -> str:
        raise RunnerError("claude timed out after 900s")

    job = make_job(JobKind.SUMMARIZE, book, "ch01")
    queue.claim(session)
    session.refresh(job)
    with pytest.raises(RunnerError):
        execute_skill_job(session, job, runner=FakeRunner(flaky), skills_dir=skills_dir)
    session.rollback()
    queue.fail(session, job, "RunnerError: timed out")  # re-queued: attempts remain

    assert ceiling.count_runs(session, book.id, SKILL_JOB_KINDS) == 1


def test_a_run_the_usage_limit_refused_does_not_count(
    session: Session, book: Document, make_job, skills_dir: Path
):
    def limited(prompt: str) -> str:
        raise UsageLimitError("usage limit reached: You've hit your session limit")

    job = make_job(JobKind.SUMMARIZE, book, "ch01")
    queue.claim(session)
    session.refresh(job)
    with pytest.raises(UsageLimitError):
        execute_skill_job(session, job, runner=FakeRunner(limited), skills_dir=skills_dir)
    session.rollback()

    assert ceiling.count_runs(session, book.id, SKILL_JOB_KINDS) == 0


def test_a_paused_document_gets_no_dedup_model_calls(session: Session, book: Document):
    book.meta = {"paused": {"reason": "ceiling", "runs": 1, "limit": 1}}
    session.add(book)
    session.commit()
    job = queue.enqueue(session, dedup_spec(book.id, [uuid.uuid4()]))
    assert job is not None
    runner = FakeRunner('{"same": true}')

    with pytest.raises(PermanentJobError, match="run ceiling reached"):
        run_dedup_job(session, job, runner=runner, embedder=_NeverEmbed())

    assert runner.calls == []


class _NeverEmbed:
    def dense(self, texts):
        raise AssertionError("a paused document must not reach the dedup pass")


def test_two_workers_cannot_both_take_the_last_run(session: Session, book: Document, make_job):
    """A run is reserved under a lock on the document row: while one worker reserves, the
    other waits and then sees the updated count, instead of both passing at limit - 1."""
    from app.db.session import engine

    first, second = (
        make_job(JobKind.SUMMARIZE, book, "ch01"),
        make_job(JobKind.SUMMARIZE, book, "ch02"),
    )
    outcome: list[str] = []

    def reserve_second() -> None:
        with Session(engine) as other:
            job, doc = other.get(Job, second.id), other.get(Document, book.id)
            try:
                ceiling.reserve_run(other, job, doc, SKILL_JOB_KINDS, 1)
                outcome.append("passed")
            except PermanentJobError:
                outcome.append("refused")

    with Session(engine) as holder:
        ceiling.reserve_run(holder, holder.get(Job, first.id), holder.get(Document, book.id),
                            SKILL_JOB_KINDS, 1, commit=False)  # fmt: skip
        racer = threading.Thread(target=reserve_second)
        racer.start()
        racer.join(timeout=0.3)
        assert racer.is_alive()  # waits on the document row instead of reading a stale count
        holder.commit()
    racer.join(timeout=5)

    assert outcome == ["refused"]

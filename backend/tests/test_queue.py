"""The Postgres job queue: dedupe, claim ordering, SKIP LOCKED, retry and backoff."""

from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlmodel import Session

from app.db.session import engine
from app.jobs import queue
from app.jobs.queue import JobSpec
from app.models.enums import JobKind, JobState
from tests.conftest import AUTH


def test_enqueue_dedupes_live_work(session: Session):
    first = queue.enqueue(session, JobSpec(kind=JobKind.EXPORT, anchor="ch01"))
    second = queue.enqueue(session, JobSpec(kind=JobKind.EXPORT, anchor="ch01"))
    other_scope = queue.enqueue(session, JobSpec(kind=JobKind.EXPORT, anchor="ch02"))

    assert first is not None
    assert second is None
    assert other_scope is not None


def test_finished_work_can_be_enqueued_again(session: Session):
    job = queue.enqueue(session, JobSpec(kind=JobKind.EXPORT))
    claimed = queue.claim(session)
    assert job is not None and claimed is not None
    queue.complete(session, claimed)

    assert queue.enqueue(session, JobSpec(kind=JobKind.EXPORT)) is not None


def test_one_follow_up_queues_behind_a_running_job_and_waits_for_it(session: Session):
    queue.enqueue(session, JobSpec(kind=JobKind.EXPORT, anchor="ch01"))
    running = queue.claim(session)
    follow_up = queue.enqueue(session, JobSpec(kind=JobKind.EXPORT, anchor="ch01"))
    duplicate = queue.enqueue(session, JobSpec(kind=JobKind.EXPORT, anchor="ch01"))
    other = queue.enqueue(session, JobSpec(kind=JobKind.EXPORT, anchor="ch02", priority=200))
    assert running is not None and follow_up is not None and other is not None

    assert duplicate is None
    assert queue.claim(session) == other  # the same scope never runs twice at once
    assert queue.claim(session) is None
    queue.complete(session, running)
    assert queue.claim(session) == follow_up


def test_claim_respects_priority_and_marks_running(session: Session):
    queue.enqueue(session, JobSpec(kind=JobKind.EXPORT, anchor="low", priority=200))
    queue.enqueue(session, JobSpec(kind=JobKind.EXPORT, anchor="high", priority=10))

    claimed = queue.claim(session)

    assert claimed is not None
    assert claimed.anchor == "high"
    assert claimed.state is JobState.RUNNING
    assert claimed.attempts == 1
    assert claimed.started_at is not None


def test_claim_filters_by_kind(session: Session):
    queue.enqueue(session, JobSpec(kind=JobKind.EXPORT))

    assert queue.claim(session, kinds=[JobKind.PARSE]) is None
    assert queue.claim(session, kinds=[JobKind.EXPORT]) is not None


def test_claim_skips_rows_locked_by_another_worker(session: Session):
    queue.enqueue(session, JobSpec(kind=JobKind.EXPORT, anchor="a", priority=1))
    queue.enqueue(session, JobSpec(kind=JobKind.EXPORT, anchor="b", priority=2))

    # Another worker is mid-claim on "a": its row lock is held in an open transaction.
    with engine.connect() as other_worker, other_worker.begin():
        other_worker.execute(text("select id from jobs where anchor = 'a' for update"))
        claimed = queue.claim(session)
        assert claimed is not None
        assert claimed.anchor == "b"

    assert queue.claim(session) is not None  # "a" is claimable once released
    assert queue.claim(session) is None


def test_failure_requeues_with_backoff_then_fails(session: Session):
    queue.enqueue(session, JobSpec(kind=JobKind.EXPORT))
    job = queue.claim(session)
    assert job is not None
    job.max_attempts = 2

    queue.fail(session, job, "boom")
    assert job.state is JobState.QUEUED
    assert job.run_after > datetime.now(UTC) + timedelta(seconds=20)
    assert queue.claim(session) is None  # backoff not elapsed

    job.run_after = datetime.now(UTC) - timedelta(seconds=1)
    session.add(job)
    session.commit()
    again = queue.claim(session)
    assert again is not None and again.attempts == 2
    queue.fail(session, again, "boom again")
    assert again.state is JobState.FAILED
    assert again.error == "boom again"


def test_permanent_failure_skips_retry(session: Session):
    queue.enqueue(session, JobSpec(kind=JobKind.EXPORT))
    job = queue.claim(session)
    assert job is not None

    queue.fail(session, job, "bad input", retry=False)

    assert job.state is JobState.FAILED


def test_complete_records_duration(session: Session):
    queue.enqueue(session, JobSpec(kind=JobKind.EXPORT))
    job = queue.claim(session)
    assert job is not None

    queue.complete(session, job, result={"ok": True})

    assert job.state is JobState.DONE
    assert job.duration_ms is not None and job.duration_ms >= 0
    assert job.result == {"ok": True}


def test_post_jobs_is_202_and_dedupes(client: TestClient):
    first = client.post("/api/v1/jobs", json={"kind": "export"}, headers=AUTH)
    second = client.post("/api/v1/jobs", json={"kind": "export"}, headers=AUTH)

    assert first.status_code == 202
    assert first.json()["deduplicated"] is False
    assert second.json()["deduplicated"] is True
    assert second.json()["job"]["id"] == first.json()["job"]["id"]

    listing = client.get("/api/v1/jobs", params={"state": "queued"}).json()
    assert listing["total"] == 1


def test_post_jobs_unknown_document_is_404(client: TestClient):
    response = client.post(
        "/api/v1/jobs",
        json={"kind": "parse", "document_id": "00000000-0000-0000-0000-000000000000"},
        headers=AUTH,
    )

    assert response.status_code == 404

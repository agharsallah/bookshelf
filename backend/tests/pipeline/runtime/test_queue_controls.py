"""Queue controls: pausing every worker at once, and capping how many jobs run together."""

import threading
import time
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.jobs import presence, queue
from app.jobs.queue import JobSpec
from app.jobs.registry import HandlerResult, JobContext
from app.jobs.worker import Worker
from app.models import Job
from app.models.enums import JobKind, JobState
from app.pipeline.runner import UsageLimitError
from app.services.app_settings import QueueControls, set_queue_controls
from tests.conftest import AUTH

URL = "/api/v1/jobs/queue"


def enqueue(session: Session, anchor: str, kind: JobKind = JobKind.EXPORT) -> Job:
    job = queue.enqueue(session, JobSpec(kind=kind, anchor=anchor))
    assert job is not None
    return job


def control(session: Session, **values: object) -> None:
    set_queue_controls(session, QueueControls(**values))  # type: ignore[arg-type]


def test_a_paused_queue_starts_nothing_until_resumed(session: Session):
    enqueue(session, "a")
    running = queue.claim(session)
    waiting = enqueue(session, "b")
    assert running is not None

    control(session, paused=True)

    assert queue.claim(session) is None
    queue.complete(session, running)  # what already runs still finishes
    session.refresh(running)
    assert running.state is JobState.DONE
    assert queue.claim(session) is None

    control(session, paused=False)
    assert queue.claim(session) == waiting


def test_max_running_holds_back_jobs_past_the_cap(session: Session):
    enqueue(session, "a")
    enqueue(session, "b")
    control(session, max_running=1)

    first = queue.claim(session)
    assert first is not None
    assert queue.claim(session) is None

    queue.complete(session, first)
    assert queue.claim(session) is not None


def test_embedding_is_neither_counted_nor_held_back_by_the_cap(session: Session):
    enqueue(session, "a")
    enqueue(session, "b")
    embed = enqueue(session, "c", kind=JobKind.EMBED)
    control(session, max_running=1)

    assert queue.claim(session, [JobKind.EMBED]) == embed
    assert queue.claim(session, [JobKind.EXPORT]) is not None  # the embed took no slot
    assert queue.claim(session, [JobKind.EXPORT]) is None


def test_a_stale_running_job_takes_no_slot_and_is_reclaimed(session: Session):
    enqueue(session, "a")
    stale = queue.claim(session)
    assert stale is not None
    stale.locked_at = datetime.now(UTC) - queue.STALE_AFTER - timedelta(seconds=1)
    session.add(stale)
    session.commit()
    control(session, max_running=1)

    assert queue.claim(session) == stale


def test_a_worker_runs_no_more_jobs_at_once_than_the_cap(session: Session):
    for anchor in ("a", "b", "c"):
        enqueue(session, anchor)
    control(session, max_running=1)
    lock = threading.Lock()
    live, peak = 0, 0

    def handler(_ctx: JobContext) -> HandlerResult:
        nonlocal live, peak
        with lock:
            live += 1
            peak = max(peak, live)
        time.sleep(0.02)
        with lock:
            live -= 1
        return HandlerResult()

    worker = Worker(concurrency=3, poll_seconds=0.01, handlers={JobKind.EXPORT: handler},
                    on_done=lambda *_: None)  # fmt: skip

    assert worker.run(once=True) == 3
    assert peak == 1


def test_a_paused_worker_drains_nothing(session: Session):
    job = enqueue(session, "a")
    control(session, paused=True)
    worker = Worker(poll_seconds=0.01, handlers={JobKind.EXPORT: lambda _: HandlerResult()},
                    on_done=lambda *_: None)  # fmt: skip

    assert worker.run(once=True) == 0
    session.refresh(job)
    assert job.state is JobState.QUEUED


def test_patching_the_queue_changes_only_the_controls_given(client: TestClient):
    paused = client.patch(URL, json={"paused": True}, headers=AUTH)
    capped = client.patch(URL, json={"max_running": 3}, headers=AUTH)
    lifted = client.patch(URL, json={"max_running": None}, headers=AUTH)
    resumed = client.patch(URL, json={"paused": False}, headers=AUTH)

    assert paused.status_code == 200
    assert (paused.json()["paused"], paused.json()["max_running"]) == (True, None)
    assert (capped.json()["paused"], capped.json()["max_running"]) == (True, 3)
    assert (lifted.json()["paused"], lifted.json()["max_running"]) == (True, None)
    assert resumed.json()["paused"] is False
    assert client.get(URL).json()["paused"] is False


def test_patching_the_queue_needs_the_api_key_and_a_positive_cap(client: TestClient):
    assert client.patch(URL, json={"paused": True}).status_code == 401
    assert client.patch(URL, json={"max_running": 0}, headers=AUTH).status_code == 422
    assert client.get(URL).json()["paused"] is False


def test_slots_count_only_workers_that_run_capped_kinds(session: Session, client: TestClient):
    presence.beat(session, Worker(label="a").id, name="api", kinds=[JobKind.EXPORT, JobKind.EMBED],
                  concurrency=2, running=0)  # fmt: skip
    presence.beat(session, Worker(label="b").id, name="embed", kinds=[JobKind.EMBED],
                  concurrency=1, running=0)  # fmt: skip

    assert client.get(URL).json()["slots"] == 2


def test_a_usage_limit_pauses_the_queue_and_hands_the_job_back_unspent(
    session: Session, client: TestClient
):
    limited = enqueue(session, "a")
    waiting = enqueue(session, "b")
    control(session, max_running=2)

    def handler(_ctx: JobContext) -> HandlerResult:
        raise UsageLimitError("usage limit reached: You've hit your session limit · resets 8pm")

    worker = Worker(concurrency=1, poll_seconds=0.01, handlers={JobKind.EXPORT: handler},
                    on_done=lambda *_: None)  # fmt: skip

    assert worker.run(once=True) == 1  # the first job hit the limit; the second never started
    for job in (limited, waiting):
        session.refresh(job)
    assert (limited.state, limited.attempts) == (JobState.QUEUED, 0)
    assert "resets 8pm" in (limited.error or "")
    assert (waiting.state, waiting.attempts) == (JobState.QUEUED, 0)
    status = client.get(URL).json()
    assert status["paused"] is True
    assert "resets 8pm" in status["paused_reason"]
    assert status["max_running"] == 2  # the cap is kept

    resumed = client.patch(URL, json={"paused": False}, headers=AUTH).json()
    assert (resumed["paused"], resumed["paused_reason"]) == (False, None)


def test_a_person_pausing_gives_no_reason(client: TestClient):
    assert client.patch(URL, json={"paused": True}, headers=AUTH).json()["paused_reason"] is None

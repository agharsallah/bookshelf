"""Queue health: places in line, worker presence, and handing jobs back on shutdown."""

import threading
from datetime import UTC, datetime, timedelta

from sqlmodel import Session, select

from app.jobs import presence, queue
from app.jobs.queue import JobSpec
from app.jobs.registry import HandlerResult, JobContext
from app.jobs.worker import Worker
from app.models import Job, WorkerRow
from app.models.enums import JobKind, JobState
from app.services.queue_view import queue_status


def enqueue(session: Session, anchor: str, **kw) -> Job:
    job = queue.enqueue(session, JobSpec(kind=JobKind.EXPORT, anchor=anchor, **kw))
    assert job is not None
    return job


def test_places_in_line_follow_claim_order_with_backoffs_last(session: Session):
    late = enqueue(session, "late")
    urgent = enqueue(session, "urgent", priority=10)
    backing_off = enqueue(session, "backing-off", priority=1)
    backing_off.run_after = datetime.now(UTC) + timedelta(minutes=2)
    session.add(backing_off)
    session.commit()

    places = queue.positions(session)

    assert [places[j.id] for j in (urgent, late, backing_off)] == [1, 2, 3]
    assert queue.claim(session).id == urgent.id  # type: ignore[union-attr]


def test_queued_work_nobody_claims_is_reported_until_a_worker_for_it_beats(session: Session):
    enqueue(session, "a")
    assert queue_status(session).unclaimed_kinds == [JobKind.EXPORT]

    worker = Worker(handlers={JobKind.EXPORT: lambda ctx: HandlerResult()}, label="test")
    worker.beat(force=True)

    status = queue_status(session)
    assert status.unclaimed_kinds == []
    assert [w.name for w in status.workers] == [worker.name]


def test_a_stale_worker_does_not_count_as_alive(session: Session):
    enqueue(session, "a")
    presence.beat(session, Worker(label="t").id, name="old", kinds=[JobKind.EXPORT],
                  concurrency=1, running=0)  # fmt: skip
    session.exec(select(WorkerRow)).one().seen_at = datetime.now(UTC) - timedelta(minutes=5)
    session.commit()

    assert queue_status(session).unclaimed_kinds == [JobKind.EXPORT]


def test_a_worker_leaves_the_presence_table_when_it_stops(session: Session):
    enqueue(session, "a")
    worker = Worker(poll_seconds=0.01, handlers={JobKind.EXPORT: lambda ctx: HandlerResult()},
                    on_done=lambda db, job: None)  # fmt: skip

    assert worker.run(once=True) == 1
    assert session.exec(select(WorkerRow)).all() == []


def test_abandon_hands_a_running_job_back_without_recording_a_failure(session: Session):
    job = enqueue(session, "slow")
    started, release = threading.Event(), threading.Event()

    def slow(ctx: JobContext) -> HandlerResult:
        started.set()
        release.wait(5)  # stands in for a `claude` run that `abandon()` kills
        raise RuntimeError("claude was killed")

    worker = Worker(poll_seconds=0.01, handlers={JobKind.EXPORT: slow}, on_done=lambda db, j: None)
    thread = threading.Thread(target=worker.run)
    thread.start()
    assert started.wait(5)

    assert worker.abandon() == 1
    release.set()
    thread.join(5)

    session.expire_all()
    back = session.get(Job, job.id)
    assert back is not None
    assert (back.state, back.attempts, back.error) == (JobState.QUEUED, 0, None)


def test_stopping_two_workers_hands_both_jobs_back_even_when_one_run_is_killed(
    session: Session,
):
    """A reload stops the pipeline worker and the narrate runner together. Killing runs is
    process-wide, so a job whose subprocess dies before its own worker released it would
    be recorded as a failed attempt; `stop_all` releases every worker's jobs first."""
    import subprocess

    from app.jobs.background import BackgroundWorker, stop_all
    from app.pipeline.runner import communicate_tracked

    jobs = [enqueue(session, "one"), enqueue(session, "two")]
    started = [threading.Event(), threading.Event()]

    def running(index: int):
        def handler(ctx: JobContext) -> HandlerResult:
            # A tracked run that abandoning kills.
            proc = subprocess.Popen(
                ["/bin/sleep", "30"], stdin=subprocess.PIPE, text=True, start_new_session=True
            )
            started[index].set()
            communicate_tracked(proc, "", timeout=30)
            raise RuntimeError(f"run killed with {proc.returncode}")

        return handler

    workers = [
        BackgroundWorker(
            Worker(
                poll_seconds=0.01,
                handlers={JobKind.EXPORT: running(i)},
                on_done=lambda db, j: None,
                concurrency=1,
            ),
            name=f"w{i}",
        )
        for i in range(2)
    ]
    for worker in workers:
        worker.start()
    assert all(event.wait(5) for event in started)

    stop_all(workers)

    session.expire_all()
    for job in jobs:
        back = session.get(Job, job.id)
        assert back is not None
        assert (back.state, back.attempts, back.error) == (JobState.QUEUED, 0, None)

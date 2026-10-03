"""What the queue looks like from outside: each job's place in line, whether any worker
is there to run it, and whether it is paused or capped (`GET /jobs/queue`, the `queue`
event of `/jobs/stream`)."""

from collections.abc import Iterable

from sqlalchemy import text
from sqlmodel import Session

from app.core.config import get_settings
from app.jobs import presence, queue, steering
from app.models import Job
from app.models.enums import JobKind, JobState
from app.schemas.job import JobPublic, QueueStatus, WorkerPublic
from app.services.app_settings import queue_controls


def public_jobs(session: Session, jobs: Iterable[Job]) -> list[JobPublic]:
    """`JobPublic`s with `queue_position` filled in for the queued ones, and `run_now`."""
    jobs = list(jobs)
    places = queue.positions(session) if any(j.state is JobState.QUEUED for j in jobs) else {}
    return [
        JobPublic.model_validate(j).model_copy(
            update={
                "queue_position": places.get(j.id),
                "run_now": j.priority <= steering.RUN_NOW_PRIORITY,
            }
        )
        for j in jobs
    ]


def public_job(session: Session, job: Job) -> JobPublic:
    return public_jobs(session, [job])[0]


def queue_status(session: Session) -> QueueStatus:
    from app.pipeline.orchestrator import ON_FAILURE  # it imports the queue and settings

    workers = presence.alive(session)
    rows = session.execute(
        text(
            "select state::text, count(*) from jobs "
            "where state in ('queued', 'running') group by state"
        )
    ).all()
    counts: dict[str, int] = {str(state): int(n) for state, n in rows}
    runnable = {
        JobKind(row[0])
        for row in session.execute(
            text(
                "select distinct kind::text from jobs where state = 'queued' and run_after <= now()"
            )
        ).all()
    }
    claimed = {kind for w in workers for kind in w.kinds}
    queued_kinds = {
        JobKind(kind): int(n)
        for kind, n in session.execute(
            text("select kind::text, count(*) from jobs where state = 'queued' group by kind")
        ).all()
    }
    uncapped = {k.value for k in steering.own_slot_kinds(get_settings())}
    controls = queue_controls(session)
    return QueueStatus(
        workers=[WorkerPublic.model_validate(w) for w in workers],
        queued=counts.get("queued", 0),
        running=counts.get("running", 0),
        unclaimed_kinds=sorted(k for k in runnable if k.value not in claimed),
        paused=controls.paused,
        paused_reason=controls.paused_reason,
        max_running=controls.max_running,
        slots=sum(w.concurrency for w in workers if set(w.kinds) - uncapped),
        kinds=dict(controls.kinds),
        first_documents=list(controls.first_documents),
        skippable_kinds=sorted(ON_FAILURE),
        queued_kinds=queued_kinds,
    )

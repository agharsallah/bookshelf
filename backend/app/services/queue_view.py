"""What the queue looks like from outside: each job's place in line, and whether any
worker is there to run it (`GET /jobs/queue`, the `queue` event of `/jobs/stream`)."""

from collections.abc import Iterable

from sqlalchemy import text
from sqlmodel import Session

from app.jobs import presence, queue
from app.models import Job
from app.models.enums import JobKind, JobState
from app.schemas.job import JobPublic, QueueStatus, WorkerPublic


def public_jobs(session: Session, jobs: Iterable[Job]) -> list[JobPublic]:
    """`JobPublic`s with `queue_position` filled in for the queued ones."""
    jobs = list(jobs)
    places = queue.positions(session) if any(j.state is JobState.QUEUED for j in jobs) else {}
    return [
        JobPublic.model_validate(j).model_copy(update={"queue_position": places.get(j.id)})
        for j in jobs
    ]


def public_job(session: Session, job: Job) -> JobPublic:
    return public_jobs(session, [job])[0]


def queue_status(session: Session) -> QueueStatus:
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
    return QueueStatus(
        workers=[WorkerPublic.model_validate(w) for w in workers],
        queued=counts.get("queued", 0),
        running=counts.get("running", 0),
        unclaimed_kinds=sorted(k for k in runnable if k.value not in claimed),
    )

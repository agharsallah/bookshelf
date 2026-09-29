"""Live pipeline progress: `GET /jobs/stream` as Server-Sent Events.

The server polls the jobs table about once a second and emits one `job` event per job
whose state or place in line changed (the first poll sends every live job as a
snapshot), and a `queue` event (`QueueStatus`: live workers, kinds nobody runs) whenever
that changes. Streams are
bounded by `max_seconds`, so a forgotten tab never holds a connection forever, and end
with `event: end` as soon as the server starts shutting down (`app.core.lifecycle`), so a
`fastapi dev` reload never waits on them; the browser's `EventSource` reconnects on its
own. A client that disconnects cancels the generator (Starlette's streaming response).

Docs: https://fastapi.tiangolo.com/tutorial/server-sent-events/
"""

import asyncio
import time
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Query
from fastapi.concurrency import run_in_threadpool
from fastapi.sse import EventSourceResponse, ServerSentEvent
from sqlmodel import Session, col, or_, select

from app.core import lifecycle
from app.models import Job
from app.models.enums import JobState
from app.schemas.job import JobPublic, QueueStatus
from app.services.queue_view import public_jobs, queue_status

router = APIRouter(prefix="/jobs", tags=["jobs"])

POLL_SECONDS = 1.0
_RECENT = timedelta(minutes=5)
_MAX_JOBS = 500

Fingerprint = tuple[JobState, int, datetime | None, int | None]


def _poll(document_id: uuid.UUID | None, since: datetime) -> tuple[list[JobPublic], QueueStatus]:
    """Live jobs plus anything that finished or was created since `since`, newest first,
    and the queue's health."""
    from app.db.session import engine

    query = select(Job).where(
        or_(
            col(Job.state).in_([JobState.QUEUED, JobState.RUNNING]),
            col(Job.finished_at) >= since,
            col(Job.created_at) >= since,
        )
    )
    if document_id is not None:
        query = query.where(Job.document_id == document_id)
    with Session(engine) as session:
        jobs = session.exec(query.order_by(col(Job.created_at).desc()).limit(_MAX_JOBS))
        return public_jobs(session, jobs), queue_status(session)


def changes(jobs: list[JobPublic], seen: dict[uuid.UUID, Fingerprint]) -> list[JobPublic]:
    """Jobs whose state, attempts, finish time or place in line differ from the last poll."""
    changed = []
    for job in jobs:
        fingerprint = (job.state, job.attempts, job.finished_at, job.queue_position)
        if seen.get(job.id) != fingerprint:
            seen[job.id] = fingerprint
            changed.append(job)
    return changed


@router.get(
    "/stream",
    response_class=EventSourceResponse,
    summary="Stream job state changes (SSE)",
)
async def stream_jobs(
    document_id: uuid.UUID | None = Query(default=None),
    max_seconds: float = Query(
        default=300, ge=0, le=3600, description="Close the stream after this long."
    ),
) -> AsyncIterator[ServerSentEvent]:
    deadline = time.monotonic() + max_seconds
    since = datetime.now(UTC) - _RECENT
    seen: dict[uuid.UUID, Fingerprint] = {}
    last_health: tuple[object, ...] | None = None
    while True:
        jobs, status = await run_in_threadpool(_poll, document_id, since)
        if (health := _health(status)) != last_health:
            last_health = health
            yield ServerSentEvent(event="queue", data=status)
        for job in changes(jobs, seen):
            yield ServerSentEvent(
                event="job",
                id=f"{job.id}:{job.attempts}:{job.state.value}",
                data=job,
            )
        if lifecycle.stopping.is_set():
            yield ServerSentEvent(event="end", data={"reason": "shutdown"})
            return
        if time.monotonic() >= deadline:
            yield ServerSentEvent(event="end", data={"reason": "max_seconds"})
            return
        await asyncio.sleep(POLL_SECONDS)


def _health(status: QueueStatus) -> tuple[object, ...]:
    """What a `queue` event reports, minus `seen_at`, which moves on every worker beat."""
    workers = tuple((w.name, w.running) for w in status.workers)
    return (
        workers,
        status.queued,
        status.running,
        tuple(status.unclaimed_kinds),
        status.paused,
        status.max_running,
        status.slots,
    )

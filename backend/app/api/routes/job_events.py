"""Live pipeline progress: `GET /jobs/stream` as Server-Sent Events.

The server polls the jobs table about once a second and emits one `job` event per job
whose state changed (the first poll sends every live job as a snapshot). Streams are
bounded by `max_seconds`, so a forgotten tab never holds a connection forever; the
browser's `EventSource` reconnects on its own.

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

from app.models import Job
from app.models.enums import JobState
from app.schemas.job import JobPublic

router = APIRouter(prefix="/jobs", tags=["jobs"])

POLL_SECONDS = 1.0
_RECENT = timedelta(minutes=5)
_MAX_JOBS = 500

Fingerprint = tuple[JobState, int, datetime | None]


def _poll(document_id: uuid.UUID | None, since: datetime) -> list[Job]:
    """Live jobs plus anything that finished or was created since `since`, newest first."""
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
        return list(session.exec(query.order_by(col(Job.created_at).desc()).limit(_MAX_JOBS)))


def changes(jobs: list[Job], seen: dict[uuid.UUID, Fingerprint]) -> list[Job]:
    """Jobs whose state, attempts or finish time differ from the last poll."""
    changed = []
    for job in jobs:
        fingerprint = (job.state, job.attempts, job.finished_at)
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
    while True:
        jobs = await run_in_threadpool(_poll, document_id, since)
        for job in changes(jobs, seen):
            yield ServerSentEvent(
                event="job",
                id=f"{job.id}:{job.attempts}:{job.state.value}",
                data=JobPublic.model_validate(job),
            )
        if time.monotonic() >= deadline:
            yield ServerSentEvent(event="end", data={"reason": "max_seconds"})
            return
        await asyncio.sleep(POLL_SECONDS)

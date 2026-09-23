"""§14 Run ceiling: stop paying for a document that keeps consuming CLI runs.

Every skill job counts its document's finished skill runs before it calls the model. At
the ceiling the document is **paused**: `documents.meta.paused = {reason, at, runs,
limit}` makes it visible (document summary/detail, the pipeline view), and every skill job
of a paused document fails at once with an error starting `run ceiling reached`, before
any model call. Idempotency hits still skip for free.

`resume` clears the pause, sets the document's own ceiling (`meta.run_ceiling`, default:
another full allowance on top of the runs so far) and requeues the jobs the ceiling
stopped. Jobs failed by the ceiling never count as runs: they never reached the model.
"""

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlmodel import Session, col, func, not_, select

from app.jobs import queue
from app.jobs.queue import JobSpec
from app.jobs.registry import PermanentJobError
from app.models import Document, Job
from app.models.enums import JobKind, JobState

CEILING_ERROR = "run ceiling reached"
PAUSED_KEY = "paused"
CEILING_KEY = "run_ceiling"


def document_ceiling(document: Document, default: int) -> int:
    value = document.meta.get(CEILING_KEY)
    return value if isinstance(value, int) and value > 0 else default


def paused(document: Document) -> dict[str, Any] | None:
    value = document.meta.get(PAUSED_KEY)
    return value if isinstance(value, dict) else None


def count_runs(
    session: Session,
    document_id: uuid.UUID,
    kinds: frozenset[JobKind],
    *,
    exclude: uuid.UUID | None = None,
) -> int:
    """Finished skill runs of a document (jobs the ceiling itself failed do not count)."""
    query = (
        select(func.count())
        .select_from(Job)
        .where(
            Job.document_id == document_id,
            col(Job.kind).in_(list(kinds)),
            col(Job.state).in_([JobState.DONE, JobState.FAILED]),
            not_(func.coalesce(col(Job.error), "").startswith(CEILING_ERROR)),
        )
    )
    if exclude is not None:
        query = query.where(Job.id != exclude)
    return int(session.exec(query).one())


def _pause(session: Session, document: Document, runs: int, limit: int) -> None:
    reason = f"{runs} skill runs reached the ceiling of {limit}"
    at = datetime.now(UTC).isoformat()
    document.meta = {**document.meta, PAUSED_KEY: {"reason": reason, "at": at, "runs": runs,
                                                   "limit": limit}}  # fmt: skip
    session.add(document)
    session.commit()


def check(
    session: Session, job: Job, document: Document, kinds: frozenset[JobKind], default: int
) -> None:
    """Raise `PermanentJobError` (and pause the document) instead of another model call."""
    limit = document_ceiling(document, default)
    state = paused(document)
    if state is not None:
        raise PermanentJobError(
            f"{CEILING_ERROR}: document paused ({state.get('reason')}); "
            f"resume it with POST /documents/{document.slug}/resume"
        )
    runs = count_runs(session, document.id, kinds, exclude=job.id)
    if runs >= limit:
        _pause(session, document, runs, limit)
        raise PermanentJobError(
            f"{CEILING_ERROR}: {runs} skill runs for this document (max {limit}); "
            f"document paused, resume it with POST /documents/{document.slug}/resume"
        )


def resume(
    session: Session,
    document: Document,
    kinds: frozenset[JobKind],
    *,
    default: int,
    max_runs: int | None = None,
) -> list[Job]:
    """Unpause, set the document's ceiling, requeue the ceiling's failures. Commits."""
    runs = count_runs(session, document.id, kinds)
    meta = {k: v for k, v in document.meta.items() if k != PAUSED_KEY}
    meta[CEILING_KEY] = max_runs if max_runs is not None else runs + default
    document.meta = meta
    session.add(document)
    session.commit()
    stopped = session.exec(
        select(Job).where(
            Job.document_id == document.id,
            Job.state == JobState.FAILED,
            col(Job.error).startswith(CEILING_ERROR),
            col(Job.result).is_(None),
        )
    ).all()
    requeued: list[Job] = []
    for job in stopped:
        spec = JobSpec(
            kind=job.kind,
            document_id=job.document_id,
            anchor=job.anchor,
            skill=job.skill,
            input_hash=job.input_hash,
            payload=job.payload or None,
            priority=job.priority,
        )
        again = queue.enqueue(session, spec)  # None: identical live work already queued
        job.result = {"requeued_as": str(again.id) if again is not None else None}
        session.add(job)
        session.commit()
        if again is not None:
            requeued.append(again)
    return requeued

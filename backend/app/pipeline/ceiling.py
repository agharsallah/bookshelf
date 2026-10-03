"""§14 Run ceiling: stop paying for a document that keeps consuming CLI runs.

Every CLI run is reserved before it starts (`reserve_run`, wired in through `metered`):
the document row is locked, the document's runs so far are counted, and the job's own
counter (`jobs.result.runs`) is incremented, in one short transaction. So the count is of
actual runs - schema retries, failed and retried attempts, each dedup verdict - and two
workers reserving at once serialize on the document row instead of both passing at the
last free run. At the ceiling the document is **paused**: `documents.meta.paused =
{reason, at, runs, limit}` makes it visible (document summary/detail, the pipeline view),
and every skill job of a paused document fails at once with an error starting `run
ceiling reached`, before any model call. Idempotency hits still skip for free.

`resume` clears the pause, sets the document's own ceiling (`meta.run_ceiling`, default:
another full allowance on top of the runs so far) and requeues the jobs the ceiling
stopped. Jobs finished before runs were counted per job count as one run each. A run the
account's usage limit refused (`UsageLimitError`) did no work, so its reservation is given
back (`refund_run`).
"""

import uuid
from collections.abc import Callable, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import text
from sqlmodel import Session, col, func, select

from app.jobs import queue
from app.jobs.queue import RUNS, JobSpec
from app.jobs.registry import PermanentJobError
from app.models import Document, Job
from app.models.enums import JobKind, JobState, Tier
from app.pipeline.runner import ModelRunner, RunResult, UsageLimitError

CEILING_ERROR = "run ceiling reached"
PAUSED_KEY = "paused"
CEILING_KEY = "run_ceiling"

# Per job: its reserved runs, or (rows from before per-job counting) one per finished,
# non-ceiling job.
_RUNS_SQL = text(
    """
    select coalesce(sum(coalesce((result->>'runs')::int,
             case when state in ('done', 'failed')
                   and coalesce(error, '') not like :ceiling_prefix then 1 else 0 end)), 0)
    from jobs where document_id = :document_id and kind = any(:kinds)
    """
)


def document_ceiling(document: Document, default: int) -> int:
    value = document.meta.get(CEILING_KEY)
    return value if isinstance(value, int) and value > 0 else default


def paused(document: Document) -> dict[str, Any] | None:
    value = document.meta.get(PAUSED_KEY)
    return value if isinstance(value, dict) else None


def count_runs(session: Session, document_id: uuid.UUID, kinds: frozenset[JobKind]) -> int:
    """CLI runs the document's skill jobs have made (reserved), in any state."""
    params = {
        "document_id": document_id,
        "kinds": sorted(k.value for k in kinds),
        "ceiling_prefix": f"{CEILING_ERROR}%",
    }
    return int(session.execute(_RUNS_SQL, params).scalar_one())


def _pause(session: Session, document: Document, runs: int, limit: int) -> None:
    reason = f"{runs} skill runs reached the ceiling of {limit}"
    at = datetime.now(UTC).isoformat()
    document.meta = {**document.meta, PAUSED_KEY: {"reason": reason, "at": at, "runs": runs,
                                                   "limit": limit}}  # fmt: skip
    session.add(document)
    session.commit()


def refuse_if_paused(session: Session, document: Document) -> None:
    """Fail fast (before any embedding or model call) for a paused document."""
    state = paused(document)
    if state is not None:
        session.commit()  # end the transaction (and any row lock) before failing
        raise PermanentJobError(
            f"{CEILING_ERROR}: document paused ({state.get('reason')}); "
            f"resume it with POST /documents/{document.slug}/resume"
        )


def reserve_run(
    session: Session,
    job: Job,
    document: Document,
    kinds: frozenset[JobKind],
    default: int,
    *,
    commit: bool = True,
) -> None:
    """Take one CLI run from the document's allowance, atomically, or raise
    `PermanentJobError` (pausing the document at the ceiling)."""
    session.execute(select(Document.id).where(Document.id == document.id).with_for_update())
    session.refresh(document, ["meta", "slug"])
    refuse_if_paused(session, document)
    limit = document_ceiling(document, default)
    runs = count_runs(session, document.id, kinds)
    if runs >= limit:
        _pause(session, document, runs, limit)
        raise PermanentJobError(
            f"{CEILING_ERROR}: {runs} skill runs for this document (max {limit}); "
            f"document paused, resume it with POST /documents/{document.slug}/resume"
        )
    current = job.result or {}
    job.result = {**current, RUNS: int(current.get(RUNS) or 0) + 1}
    session.add(job)
    if commit:
        session.commit()


def refund_run(session: Session, job: Job) -> None:
    """Give back the run `reserve_run` last took for `job`. Commits."""
    current = job.result or {}
    job.result = {**current, RUNS: max(int(current.get(RUNS) or 0) - 1, 0)}
    session.add(job)
    session.commit()


class _Metered:
    """A `ModelRunner` that reserves a run before every call it passes on, and gives it
    back when the usage limit refused the call."""

    def __init__(
        self, runner: ModelRunner, reserve: Callable[[], None], refund: Callable[[], None]
    ) -> None:
        self._runner, self._reserve, self._refund = runner, reserve, refund

    def run(self, prompt: str, *, tier: Tier, images: Sequence[Path] = ()) -> RunResult:
        self._reserve()
        try:
            return self._runner.run(prompt, tier=tier, images=images)
        except UsageLimitError:
            self._refund()
            raise


def metered(
    runner: ModelRunner,
    session: Session,
    job: Job,
    document: Document,
    kinds: frozenset[JobKind],
    default: int,
) -> ModelRunner:
    """`runner`, with every call counted against `document`'s run ceiling first."""
    return _Metered(
        runner,
        lambda: reserve_run(session, job, document, kinds, default),
        lambda: refund_run(session, job),
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
    requeued_before = func.coalesce(col(Job.result).op("?")("requeued_as"), False)
    stopped = session.exec(
        select(Job).where(
            Job.document_id == document.id,
            Job.state == JobState.FAILED,
            col(Job.error).startswith(CEILING_ERROR),
            ~requeued_before,
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
        job.result = {**(job.result or {}), "requeued_as": str(again.id) if again else None}
        session.add(job)
        session.commit()
        if again is not None:
            requeued.append(again)
    return requeued

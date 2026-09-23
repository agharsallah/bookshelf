"""Postgres-backed job queue over the `jobs` table.

No Redis: `claim()` uses `FOR UPDATE SKIP LOCKED`, so any number of workers can poll
the same table without double-claiming. `jobs_dedupe_idx` makes `enqueue()` idempotent
for live work: enqueueing the same (kind, document, anchor, input_hash) while one is
queued or running returns None instead of a second row.
"""

import json
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, text
from sqlmodel import Session, select
from sqlmodel.sql.expression import SelectOfScalar

from app.models import Job
from app.models.enums import JobKind, JobState, RunMode

# Exponential backoff between attempts: 30s, 2m, 8m, ...
_BACKOFF_BASE_SECONDS = 30
# A running job whose worker died is reclaimed after this long.
STALE_AFTER = timedelta(minutes=30)


@dataclass(frozen=True, slots=True)
class JobSpec:
    kind: JobKind
    document_id: uuid.UUID | None = None
    anchor: str | None = None
    skill: str | None = None
    skill_version: str | None = None
    input_hash: str | None = None
    payload: dict[str, Any] | None = None
    priority: int = 100
    run_mode: RunMode = RunMode.BATCH


def _now() -> datetime:
    return datetime.now(UTC)


def enqueue(session: Session, spec: JobSpec) -> Job | None:
    """Insert a queued job. Returns None when identical live work already exists.

    Commits: the job must be visible to workers as soon as this returns.
    """
    row = session.execute(
        text(
            """
            insert into jobs (id, kind, document_id, anchor, skill, skill_version,
                              input_hash, payload, priority, run_mode)
            values (:id, :kind, :document_id, :anchor, :skill, :skill_version,
                    :input_hash, cast(:payload as jsonb), :priority, :run_mode)
            on conflict do nothing
            returning id
            """
        ),
        {
            "id": uuid.uuid4(),
            "kind": spec.kind.value,
            "document_id": spec.document_id,
            "anchor": spec.anchor,
            "skill": spec.skill,
            "skill_version": spec.skill_version,
            "input_hash": spec.input_hash,
            "payload": json.dumps(spec.payload or {}, default=str),
            "priority": spec.priority,
            "run_mode": spec.run_mode.value,
        },
    ).first()
    session.commit()
    return session.get(Job, row[0]) if row else None


def claim(session: Session, kinds: list[JobKind] | None = None) -> Job | None:
    """Atomically move the next runnable job to `running` and return it.

    Also picks up `running` jobs whose lock went stale (crashed worker).
    """
    kind_filter = "and kind = any(:kinds)" if kinds else ""
    row = session.execute(
        text(
            f"""
            update jobs set state = 'running', locked_at = now(),
                            started_at = coalesce(started_at, now()), attempts = attempts + 1
            where id = (
              select id from jobs
              where ((state = 'queued' and run_after <= now())
                     or (state = 'running' and locked_at < now() - :stale))
                {kind_filter}
              order by priority, run_after
              for update skip locked
              limit 1
            )
            returning id
            """  # noqa: S608  (kind_filter is a constant, values are bound)
        ),
        {"kinds": [k.value for k in kinds or []], "stale": STALE_AFTER},
    ).first()
    session.commit()
    if row is None:
        return None
    job = session.get(Job, row[0])
    if job is not None:
        session.refresh(job)
    return job


def complete(
    session: Session,
    job: Job,
    *,
    state: JobState = JobState.DONE,
    result: dict[str, Any] | None = None,
    cost_tokens: int | None = None,
) -> None:
    """Mark a claimed job finished (`done`, or `skipped` for an idempotency hit)."""
    finished = _now()
    job.state = state
    job.result = result
    job.cost_tokens = cost_tokens
    job.error = None
    job.locked_at = None
    job.finished_at = finished
    if job.started_at is not None:
        job.duration_ms = int((finished - job.started_at).total_seconds() * 1000)
    session.add(job)
    session.commit()


def fail(session: Session, job: Job, error: str, *, retry: bool = True) -> None:
    """Record a failure; requeue with backoff while attempts remain."""
    job.error = error[:4000]
    job.locked_at = None
    if retry and job.attempts < job.max_attempts:
        job.state = JobState.QUEUED
        job.run_after = _now() + timedelta(seconds=_BACKOFF_BASE_SECONDS * 4 ** (job.attempts - 1))
    else:
        job.state = JobState.FAILED
        job.finished_at = _now()
    session.add(job)
    session.commit()


def _filtered[Q: SelectOfScalar[Any]](
    query: Q,
    *,
    state: JobState | None,
    kind: JobKind | None,
    document_id: uuid.UUID | None,
) -> Q:
    if state is not None:
        query = query.where(Job.state == state)
    if kind is not None:
        query = query.where(Job.kind == kind)
    if document_id is not None:
        query = query.where(Job.document_id == document_id)
    return query


def count_jobs(
    session: Session,
    *,
    state: JobState | None = None,
    kind: JobKind | None = None,
    document_id: uuid.UUID | None = None,
) -> int:
    query = _filtered(
        select(func.count()).select_from(Job), state=state, kind=kind, document_id=document_id
    )
    return int(session.exec(query).one())


def list_jobs(
    session: Session,
    *,
    state: JobState | None = None,
    kind: JobKind | None = None,
    document_id: uuid.UUID | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[Job]:
    query = _filtered(select(Job), state=state, kind=kind, document_id=document_id)
    query = query.order_by(Job.created_at.desc()).offset(offset).limit(limit)  # type: ignore[attr-defined]
    return list(session.exec(query))

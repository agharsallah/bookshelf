"""Enqueue helpers shared by services that start pipeline work."""

from sqlmodel import Session, select

from app.jobs import queue
from app.models import Job
from app.models.enums import JobState


def enqueue_or_live(session: Session, spec: queue.JobSpec) -> tuple[Job, bool]:
    """Enqueue `spec`, or return the live job that already covers the same scope.

    Returns `(job, deduplicated)`. Commits (via `queue.enqueue`), so anything added to the
    session before the call is committed in the same transaction as the job.
    """
    job = queue.enqueue(session, spec)
    if job is not None:
        return job, False
    live = session.exec(
        select(Job)
        .where(
            Job.kind == spec.kind,
            Job.document_id == spec.document_id,
            Job.anchor == spec.anchor,
            Job.input_hash == spec.input_hash,
            Job.state.in_([JobState.QUEUED, JobState.RUNNING]),  # type: ignore[attr-defined]
        )
        .order_by(Job.created_at.desc())  # type: ignore[attr-defined]
    ).first()
    if live is not None:
        return live, True
    job = queue.enqueue(session, spec)  # finished between the insert and the read
    if job is None:  # pragma: no cover - requires a third racing writer
        raise RuntimeError(f"Could not enqueue {spec.kind} for {spec.document_id}")
    return job, False

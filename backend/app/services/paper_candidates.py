"""The reading queue behind `/papers/candidates` and `/papers/watch` (docs/PAPERS.md §7).

Reads rank by `score`; writes only move a candidate's `status` (queue / dismiss / back to
suggested) or queue the jobs that do the slow work (`paper_candidates`, `paper_watch`,
`paper_fetch`). `ingested` is set by `paper_fetch` alone.
"""

import uuid

from sqlmodel import Session, col, func, select

from app.core.errors import ConflictError, NotFoundError
from app.jobs.queue import JobSpec
from app.models import Job, ReadingCandidate
from app.models.enums import CandidateStatus, JobKind
from app.papers.watch import watch_spec
from app.services.errors import InvalidInputError
from app.services.jobs import enqueue_or_live

QUEUE_STATUSES = (CandidateStatus.SUGGESTED, CandidateStatus.QUEUED)


def list_candidates(
    session: Session, status: CandidateStatus | None, *, limit: int, offset: int
) -> tuple[list[ReadingCandidate], int]:
    """Best first. Without `status`: the live queue (suggested and queued)."""
    statuses = [status] if status is not None else list(QUEUE_STATUSES)
    where = col(ReadingCandidate.status).in_(statuses)
    total = session.exec(select(func.count()).select_from(ReadingCandidate).where(where)).one()
    rows = session.exec(
        select(ReadingCandidate)
        .where(where)
        .order_by(col(ReadingCandidate.score).desc(), col(ReadingCandidate.id))
        .limit(limit)
        .offset(offset)
    ).all()
    return list(rows), int(total)


def get_candidate(session: Session, candidate_id: uuid.UUID) -> ReadingCandidate:
    candidate = session.get(ReadingCandidate, candidate_id)
    if candidate is None:
        raise NotFoundError(f"Reading candidate {candidate_id} does not exist.")
    return candidate


def set_status(
    session: Session, candidate_id: uuid.UUID, status: CandidateStatus
) -> ReadingCandidate:
    """Queue, dismiss or restore a candidate. `ingested` is the ingest job's to set."""
    candidate = get_candidate(session, candidate_id)
    if status == CandidateStatus.INGESTED:
        raise InvalidInputError(
            "A candidate becomes `ingested` by `POST /papers/candidates/{id}/ingest`.",
            field="body.status",
        )
    if candidate.status == CandidateStatus.INGESTED:
        raise ConflictError("This candidate is already on the shelf.")
    candidate.status = status
    session.add(candidate)
    session.commit()
    session.refresh(candidate)
    return candidate


def queue_ingest(session: Session, candidate_id: uuid.UUID) -> Job:
    """Queue `paper_fetch` for a candidate with an open-access PDF."""
    candidate = get_candidate(session, candidate_id)
    if candidate.status == CandidateStatus.INGESTED:
        raise ConflictError(
            "This candidate is already on the shelf.",
            details=[{"document_id": str(candidate.document_id)}],
        )
    if not candidate.arxiv_id and not candidate.pdf_url:
        raise InvalidInputError("This candidate has no open-access PDF to download.")
    spec = JobSpec(
        kind=JobKind.PAPER_FETCH,
        input_hash=str(candidate.id),
        payload={"candidate_id": str(candidate.id)},
    )
    job, _ = enqueue_or_live(session, spec)
    return job


def queue_refresh(session: Session) -> Job:
    job, _ = enqueue_or_live(session, JobSpec(kind=JobKind.PAPER_CANDIDATES))
    return job


def queue_watch(session: Session, *, force: bool) -> Job:
    job, _ = enqueue_or_live(session, watch_spec(force=force))
    return job

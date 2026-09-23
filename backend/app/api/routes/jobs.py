"""Job queue: enqueue work and watch it (§13). Ingest and re-runs return `202` + a job."""

import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlmodel import select

from app.api.deps import LimitDep, OffsetDep, SessionDep
from app.core.errors import NotFoundError
from app.core.security import require_api_key
from app.jobs import queue
from app.models import Document, Job
from app.models.enums import JobKind, JobState
from app.schemas.common import Page
from app.schemas.job import JobAccepted, JobCreate, JobPublic

router = APIRouter(prefix="/jobs", tags=["jobs"])


@router.get("", response_model=Page[JobPublic], summary="List jobs (queue view)")
def list_jobs(
    session: SessionDep,
    limit: LimitDep = 50,
    offset: OffsetDep = 0,
    state: JobState | None = Query(default=None),
    kind: JobKind | None = Query(default=None),
    document_id: uuid.UUID | None = Query(default=None),
) -> Page[JobPublic]:
    jobs = queue.list_jobs(
        session, state=state, kind=kind, document_id=document_id, limit=limit, offset=offset
    )
    total = queue.count_jobs(session, state=state, kind=kind, document_id=document_id)
    return Page(
        items=[JobPublic.model_validate(j) for j in jobs], total=total, limit=limit, offset=offset
    )


@router.get("/{job_id}", response_model=JobPublic, summary="Get one job")
def get_job(job_id: uuid.UUID, session: SessionDep) -> JobPublic:
    job = session.get(Job, job_id)
    if job is None:
        raise NotFoundError(f"Job {job_id} does not exist.")
    return JobPublic.model_validate(job)


@router.post(
    "",
    response_model=JobAccepted,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(require_api_key)],
    summary="Enqueue a job",
)
def create_job(body: JobCreate, session: SessionDep) -> JobAccepted:
    if body.document_id is not None and session.get(Document, body.document_id) is None:
        raise NotFoundError(f"Document {body.document_id} does not exist.")
    spec = queue.JobSpec(
        kind=body.kind,
        document_id=body.document_id,
        anchor=body.anchor,
        payload={"force": True} if body.force else None,
    )
    job = queue.enqueue(session, spec)
    if job is not None:
        return JobAccepted(job=JobPublic.model_validate(job), deduplicated=False)
    live = session.exec(
        select(Job).where(
            Job.kind == body.kind,
            Job.document_id == body.document_id,
            Job.anchor == body.anchor,
            Job.state.in_([JobState.QUEUED, JobState.RUNNING]),  # type: ignore[attr-defined]
        )
    ).first()
    if live is None:  # finished between the insert and this read: enqueue again
        job = queue.enqueue(session, spec)
        assert job is not None  # noqa: S101
        return JobAccepted(job=JobPublic.model_validate(job), deduplicated=False)
    return JobAccepted(job=JobPublic.model_validate(live), deduplicated=True)

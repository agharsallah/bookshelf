"""Job queue: enqueue work and watch it (§13). Ingest and re-runs return `202` + a job."""

import uuid

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import LimitDep, OffsetDep, SessionDep
from app.api.pipeline import SkillsDirDep
from app.core.errors import ConflictError, NotFoundError
from app.core.security import require_api_key
from app.jobs import queue
from app.models import Job
from app.models.enums import JobKind, JobState
from app.pipeline.skills import load_catalogue
from app.schemas.common import Page
from app.schemas.job import JobAccepted, JobCreate, JobPublic, QueueStatus
from app.services import jobs as job_service
from app.services.queue_view import public_job, public_jobs, queue_status

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
    return Page(items=public_jobs(session, jobs), total=total, limit=limit, offset=offset)


@router.get(
    "/queue",
    response_model=QueueStatus,
    summary="Queue health: live workers, and job kinds nobody is running",
    description=(
        "`unclaimed_kinds` lists kinds with runnable queued jobs that no live worker claims: "
        "those jobs will not start until a worker for them runs. The API runs a worker "
        "itself unless `BOOKSHELF_API_WORKER=false`."
    ),
)
def get_queue(session: SessionDep) -> QueueStatus:
    return queue_status(session)


@router.get("/{job_id}", response_model=JobPublic, summary="Get one job")
def get_job(job_id: uuid.UUID, session: SessionDep) -> JobPublic:
    job = session.get(Job, job_id)
    if job is None:
        raise NotFoundError(f"Job {job_id} does not exist.")
    return public_job(session, job)


@router.post(
    "",
    response_model=JobAccepted,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(require_api_key)],
    summary="Enqueue a job",
)
def create_job(body: JobCreate, session: SessionDep, skills_dir: SkillsDirDep) -> JobAccepted:
    """Queue a (re-)run. `deduplicated` is true when an identical job is already queued:
    same kind and scope, and the same `skill` (derive) or `note_id` (structure_note)."""
    request = job_service.JobRequest(
        kind=body.kind,
        document_id=body.document_id,
        anchor=body.anchor,
        skill=body.skill,
        note_id=body.note_id,
        force=body.force,
    )
    spec = job_service.job_spec(session, request, load_catalogue(skills_dir))
    job, deduplicated = job_service.enqueue_or_live(session, spec)
    return JobAccepted(job=public_job(session, job), deduplicated=deduplicated)


def _job(session: SessionDep, job_id: uuid.UUID) -> Job:
    job = session.get(Job, job_id)
    if job is None:
        raise NotFoundError(f"Job {job_id} does not exist.")
    return job


@router.delete(
    "/{job_id}",
    response_model=JobPublic,
    dependencies=[Depends(require_api_key)],
    summary="Cancel a queued job",
    description=(
        "A `queued` job becomes `skipped` with error `cancelled by user`. Like a failed job "
        "it releases stage barriers (e.g. the last element job releases section notes) but "
        "never counts as the stage's output (a cancelled `embed` does not make the document "
        "`indexed`). `409` for a job that is running or finished."
    ),
)
def cancel_job(job_id: uuid.UUID, session: SessionDep) -> JobPublic:
    from app.pipeline import orchestrator

    job = queue.cancel(session, job_id)
    if job is None:
        current = _job(session, job_id)
        raise ConflictError(
            f"Only a queued job can be cancelled; this one is {current.state.value}.",
            [{"field": "state", "state": current.state.value}],
        )
    orchestrator.on_job_done(session, job)
    return JobPublic.model_validate(job)


@router.post(
    "/{job_id}/retry",
    response_model=JobAccepted,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(require_api_key)],
    summary="Retry a failed job",
    description=(
        "Queues the same work again (kind, scope, skill, note, payload) without `force`, so "
        "an unchanged input is still a free skip. `409` unless the job `failed`; "
        "`deduplicated` when an identical job is already queued."
    ),
)
def retry_job(job_id: uuid.UUID, session: SessionDep) -> JobAccepted:
    job = _job(session, job_id)
    if job.state is not JobState.FAILED:
        raise ConflictError(
            f"Only a failed job can be retried; this one is {job.state.value}.",
            [{"field": "state", "state": job.state.value}],
        )
    again, deduplicated = job_service.enqueue_or_live(session, queue.retry_spec(job))
    return JobAccepted(job=public_job(session, again), deduplicated=deduplicated)

"""Job queue: enqueue work and watch it (§13). Ingest and re-runs return `202` + a job."""

import uuid
from dataclasses import replace

from fastapi import APIRouter, Depends, Query, status
from sqlmodel import col, select

from app.api.deps import LimitDep, OffsetDep, SessionDep, SettingsDep
from app.api.pipeline import SkillsDirDep, pipeline_errors
from app.core.errors import ConflictError, NotFoundError
from app.core.security import require_api_key
from app.jobs import queue
from app.models import Job, ModelRun
from app.models.enums import JobKind, JobState
from app.pipeline.skills import load_catalogue
from app.schemas.common import Page
from app.schemas.job import (
    JobAccepted,
    JobCreate,
    JobPublic,
    ModelRunPublic,
    QueueControlsUpdate,
    QueueStatus,
    RunLogPage,
)
from app.services import app_settings
from app.services import jobs as job_service
from app.services.queue_view import public_job, public_jobs, queue_status
from app.telemetry import run_log

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


@router.patch(
    "/queue",
    response_model=QueueStatus,
    dependencies=[Depends(require_api_key)],
    summary="Pause or resume the queue, or cap how many jobs run at once",
    description=(
        "`paused: true` stops every worker from starting a job: running jobs finish, queued "
        "ones wait (new ones still queue) until `paused: false`. `max_running` caps the "
        "jobs running at once across all workers (`null`: no cap beyond the workers' slots, "
        "`BOOKSHELF_WORKER_CONCURRENCY` each); lowering it stops nothing already running. "
        "Narration, build runs and embedded-Qdrant embedding are not capped. Fields left "
        "out keep their value; workers obey a change on their next claim, with no restart."
    ),
)
def update_queue(body: QueueControlsUpdate, session: SessionDep) -> QueueStatus:
    changes = body.model_dump(include=body.model_fields_set)
    if changes.get("paused", False) is None:
        changes.pop("paused")
    if "paused" in changes:  # a person's pause or resume replaces the queue's own reason
        changes["paused_reason"] = None
    current = app_settings.queue_controls(session)
    app_settings.set_queue_controls(session, replace(current, **changes))
    return queue_status(session)


@router.get("/{job_id}", response_model=JobPublic, summary="Get one job")
def get_job(job_id: uuid.UUID, session: SessionDep) -> JobPublic:
    job = session.get(Job, job_id)
    if job is None:
        raise NotFoundError(f"Job {job_id} does not exist.")
    return public_job(session, job)


@router.get(
    "/{job_id}/runs",
    response_model=list[ModelRunPublic],
    summary="A job's run log: every CLI call it made",
    description=(
        "One entry per model call over all the job's attempts, oldest first: model, tier, "
        "tokens, cost, time, turns, and the error when the call failed. Empty for work that "
        "calls no model (parse, embed, export) or that has not run yet."
    ),
)
def get_job_runs(job_id: uuid.UUID, session: SessionDep) -> list[ModelRunPublic]:
    _job(session, job_id)
    runs = session.exec(
        select(ModelRun)
        .where(ModelRun.job_id == job_id)
        .order_by(col(ModelRun.created_at), col(ModelRun.attempt), col(ModelRun.call))
    )
    return [ModelRunPublic.model_validate(run) for run in runs]


@router.get(
    "/{job_id}/log",
    response_model=RunLogPage,
    summary="A job's run log, as it happens",
    description=(
        "What the job did, one event per line, over all its attempts: started, each model "
        "call with its prompt, the model's output as it streamed in (`text`, `thinking`), "
        "tool use, the reply it returned or its error, the schema gate's verdict, and how "
        "the attempt finished. Poll with `after` set to the last `next` to follow a running "
        "job. Empty for a job that has not run (or ran before logs were kept, or whose log "
        "was pruned after `BOOKSHELF_RUN_LOG_DAYS`)."
    ),
)
def get_job_log(
    job_id: uuid.UUID, session: SessionDep, after: int = Query(default=0, ge=0)
) -> RunLogPage:
    _job(session, job_id)
    events, offset = run_log.read(job_id, after=after)
    return RunLogPage(events=events, next=offset)


@router.post(
    "",
    response_model=JobAccepted,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(require_api_key)],
    summary="Enqueue a job",
)
def create_job(
    body: JobCreate, session: SessionDep, skills_dir: SkillsDirDep, settings: SettingsDep
) -> JobAccepted:
    """Queue a (re-)run. `deduplicated` is true when an identical job is already queued:
    same kind and scope, and the same `skill` and `params` (derive), `note_id`
    (structure_note), or script and voices (narrate)."""
    request = job_service.JobRequest(
        kind=body.kind,
        document_id=body.document_id,
        anchor=body.anchor,
        skill=body.skill,
        note_id=body.note_id,
        force=body.force,
        params=body.params,
        voices=tuple(body.voices) if body.voices is not None else None,
        artifact_id=body.artifact_id,
    )
    with pipeline_errors():
        spec = job_service.job_spec(
            session, request, load_catalogue(skills_dir), voices_dir=settings.voices_dir
        )
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
    "/{job_id}/run-now",
    response_model=JobPublic,
    dependencies=[Depends(require_api_key)],
    summary="Run a queued job next",
    description=(
        "Moves a `queued` job to the front of the line: it takes the next free slot under "
        "`max_running` (it never exceeds the cap), starts even while the queue is paused, "
        "and skips a retry backoff. Several jobs sent this way run in the order they were "
        "sent. `409` for a job that is running or finished."
    ),
)
def run_job_now(job_id: uuid.UUID, session: SessionDep) -> JobPublic:
    job = queue.run_now(session, job_id)
    if job is None:
        current = _job(session, job_id)
        raise ConflictError(
            f"Only a queued job can be run now; this one is {current.state.value}.",
            [{"field": "state", "state": current.state.value}],
        )
    return public_job(session, job)


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

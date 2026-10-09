"""When a document's pills are harvested again (docs/PILLS.md §4).

A `harvest_pills` job per document, queued:

* after a job stored an artifact of a harvestable type (derive and stage jobs), or voiced
  an audio summary (`narrate`: its turns become listen clips);
* after a review changed which version is preferred: approve, edit, reject, reopen
  (`orchestrator.on_review` / `on_reopen`, auto-approval included);
* by `POST /pills/rebuild` (one document, or every document: the backfill).

The queue dedupes a queued job per `(kind, document)` (no anchor, no input hash), so a
burst of triggers (a book's figure descriptions landing one by one) costs one harvest,
which runs after the pipeline's own work (`HARVEST_PRIORITY`).
"""

import uuid

from sqlmodel import Session, col, select

from app.jobs import queue
from app.jobs.queue import JobSpec
from app.models import Artifact, Document, Job
from app.models.document import not_archived
from app.models.enums import JobKind, JobState
from app.pills.harvest import HARVESTABLE_TYPES

HARVEST_PRIORITY = 200
# Python jobs whose output feeds pills without being a harvestable artifact's job.
FEEDING_JOBS = frozenset({JobKind.NARRATE})


def harvest_spec(document_id: uuid.UUID) -> JobSpec:
    return JobSpec(kind=JobKind.HARVEST_PILLS, document_id=document_id, priority=HARVEST_PRIORITY)


def after_artifact(session: Session, artifact: Artifact) -> list[Job]:
    """Queue a harvest when `artifact` is of a type pills are harvested from."""
    if artifact.type not in HARVESTABLE_TYPES:
        return []
    job = queue.enqueue(session, harvest_spec(artifact.document_id))
    return [job] if job is not None else []


def after_job(session: Session, job: Job) -> list[Job]:
    """Queue a harvest after a job that stored a harvestable artifact (or voiced one)."""
    if job.state is not JobState.DONE or job.document_id is None:
        return []
    if job.kind in FEEDING_JOBS:
        queued = queue.enqueue(session, harvest_spec(job.document_id))
        return [queued] if queued is not None else []
    made = (job.result or {}).get("artifact_id")
    if not isinstance(made, str):
        return []
    try:
        artifact = session.get(Artifact, uuid.UUID(made))
    except ValueError:
        return []
    return after_artifact(session, artifact) if artifact is not None else []


def rebuild(session: Session, document_id: uuid.UUID | None = None) -> list[Job]:
    """`POST /pills/rebuild`: a harvest for one document, or for every unarchived one (the
    backfill). A document whose harvest is already queued keeps that job."""
    from app.services.jobs import enqueue_or_live  # lazy: services import the pipeline

    if document_id is not None:
        ids = [document_id]
    else:
        ids = list(
            session.exec(
                select(Document.id).where(not_archived()).order_by(col(Document.created_at))
            )
        )
    return [enqueue_or_live(session, harvest_spec(doc_id))[0] for doc_id in ids]

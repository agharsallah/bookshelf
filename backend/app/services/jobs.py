"""Enqueue helpers shared by services that start pipeline work, and `POST /jobs` specs."""

import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from sqlmodel import Session, select

from app.core.errors import NotFoundError
from app.jobs import queue
from app.jobs.queue import JobSpec
from app.models import Document, Job, Note
from app.models.enums import JobKind, JobState
from app.pipeline.skills import Skill
from app.services.errors import InvalidInputError


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


@dataclass(frozen=True, slots=True)
class JobRequest:
    """What `POST /jobs` asks for, before validation against the data and the catalogue."""

    kind: JobKind
    document_id: uuid.UUID | None = None
    anchor: str | None = None
    skill: str | None = None
    note_id: uuid.UUID | None = None
    force: bool = False


def _check_skill(request: JobRequest, catalogue: Mapping[str, Skill]) -> str | None:
    if request.skill is None:
        if request.kind is JobKind.DERIVE:
            raise InvalidInputError("`derive` jobs need a `skill`.", field="body.skill")
        return None
    skill = catalogue.get(request.skill)
    if skill is None:
        raise InvalidInputError(f"No skill named {request.skill!r}.", field="body.skill")
    if skill.meta.job_kind is not request.kind:
        runs = skill.meta.job_kind.value if skill.meta.job_kind else "no job"
        raise InvalidInputError(
            f"Skill {request.skill!r} runs as {runs}, not {request.kind.value}.",
            field="body.skill",
        )
    return skill.name


def _check_note(session: Session, request: JobRequest) -> Note | None:
    if request.note_id is None:
        if request.kind is JobKind.STRUCTURE_NOTE:
            raise InvalidInputError("`structure_note` jobs need a `note_id`.", field="body.note_id")
        return None
    note = session.get(Note, request.note_id)
    if note is None or note.document_id != request.document_id:
        raise InvalidInputError(
            f"Note {request.note_id} does not belong to this document.", field="body.note_id"
        )
    if note.raw is None:
        raise InvalidInputError(
            f"Note {request.note_id} is a plain highlight: no words to structure.",
            field="body.note_id",
        )
    return note


def job_spec(session: Session, request: JobRequest, catalogue: Mapping[str, Skill]) -> JobSpec:
    """Validate a manual job request and build its spec.

    `input_hash` doubles as the queue's dedupe key, so re-runs of different skills
    (`skill:<name>`) or notes (`note:<id>`) on the same scope are distinct live jobs.
    """
    if request.document_id is not None and session.get(Document, request.document_id) is None:
        raise NotFoundError(f"Document {request.document_id} does not exist.")
    skill = _check_skill(request, catalogue)
    note = _check_note(session, request)
    payload: dict[str, Any] = {"force": True} if request.force else {}
    if note is not None:
        payload["note_id"] = str(note.id)
        key: str | None = f"note:{note.id}"
    else:
        key = f"skill:{skill}" if skill is not None else None
    return JobSpec(
        kind=request.kind,
        document_id=request.document_id,
        anchor=note.anchor if note is not None and request.anchor is None else request.anchor,
        skill=skill,
        input_hash=key,
        payload=payload or None,
    )

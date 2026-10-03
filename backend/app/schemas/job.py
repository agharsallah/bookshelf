"""Wire shapes for the job queue (§13 `POST /jobs`, `GET /jobs`)."""

import uuid
from datetime import datetime
from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import JobKind, JobState, RunMode


class JobCreate(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={
            "examples": [
                {"kind": "summarize", "document_id": "…", "anchor": "ch03"},
                {"kind": "derive", "document_id": "…", "anchor": "ch03", "skill": "make-quiz"},
                {"kind": "structure_note", "document_id": "…", "note_id": "…", "force": True},
                {
                    "kind": "derive",
                    "document_id": "…",
                    "skill": "write-audio-summary",
                    "params": {"minutes": 15, "format": "conversation", "language": "en"},
                    "voices": ["alice", "frank"],
                },
                {"kind": "narrate", "document_id": "…", "artifact_id": "…", "voices": ["maya"]},
                {"kind": "narrate", "document_id": "…", "anchor": "ch03", "voices": ["alice"]},
            ]
        },
    )

    kind: JobKind
    document_id: uuid.UUID | None = None
    anchor: Annotated[str | None, Field(default=None, max_length=200)]
    force: Annotated[
        bool, Field(default=False, description="Re-run even if an artifact for this input exists.")
    ]
    skill: Annotated[
        str | None,
        Field(
            default=None,
            max_length=100,
            description="Skill package to run. Required for `derive`; else must match `kind`.",
        ),
    ]
    note_id: Annotated[
        uuid.UUID | None,
        Field(default=None, description="Required for `structure_note`: a note of the document."),
    ]
    params: Annotated[
        dict[str, str | int] | None,
        Field(
            default=None,
            description="Run parameters of a skill that declares them (`GET /skills` `params`).",
        ),
    ]
    voices: Annotated[
        list[Annotated[str, Field(max_length=80)]] | None,
        Field(
            default=None,
            max_length=4,
            description="Narrated skills and `narrate`: a voice id (`GET /audio/voices`) per "
            "speaker, speaker 1 first. Omitted: the format's default cast.",
        ),
    ]
    artifact_id: Annotated[
        uuid.UUID | None,
        Field(
            default=None,
            description="`narrate`: the script to voice. Without it, `narrate` reads the "
            "chapter at `anchor` aloud, as written, with one voice.",
        ),
    ]


class JobPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    kind: JobKind
    document_id: uuid.UUID | None
    anchor: str | None
    skill: str | None
    skill_version: str | None
    payload: Annotated[
        dict[str, Any],
        Field(description="What the job was asked for: `params`, `voices`, `artifact_id`…"),
    ] = {}
    state: JobState
    attempts: int
    error: str | None
    result: dict[str, Any] | None
    run_mode: RunMode | None
    duration_ms: int | None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    # When a queued job may start: now for fresh work, later while a retry backs off.
    run_after: datetime
    # A queued job's place in line (1 = next to start); null unless queued.
    queue_position: int | None = None
    # Sent to the front by a person (`POST /jobs/{id}/run-now`): starts even while paused.
    run_now: bool = False


class JobAccepted(BaseModel):
    """`202` body: the queued job, or the live one that already covers this work."""

    job: JobPublic
    deduplicated: bool


class WorkerPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str
    kinds: list[str]
    concurrency: int
    running: int
    started_at: datetime
    seen_at: datetime


class QueueStatus(BaseModel):
    """Whether queued work will actually run: who is polling, and what nobody picks up."""

    workers: list[WorkerPublic]
    queued: int
    running: int
    # Kinds with runnable queued jobs that no live worker claims: those jobs wait forever
    # until a worker for them starts. Empty when every queued job has a taker.
    unclaimed_kinds: list[JobKind]
    # Paused: no worker starts a job; running ones finish, queued ones wait for a resume.
    paused: bool = False
    # Why the queue paused itself (the model's usage limit, with when it resets); `None`
    # when a person paused it or it runs.
    paused_reason: str | None = None
    # Jobs that may run at once across every worker (`None`: as many as there are slots).
    # Embedding and narration are not counted: they spend no tokens and run one at a time.
    max_running: int | None = None
    # Job slots across live workers that run token-spending work: the most that can run.
    slots: int = 0


class QueueControlsUpdate(BaseModel):
    """`PATCH /jobs/queue`: the controls given change; the others keep their value."""

    paused: bool | None = None
    # `null` lifts the cap. Above `slots` it changes nothing until more workers start.
    max_running: Annotated[int | None, Field(ge=1, le=64)] = None

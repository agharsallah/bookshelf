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


class JobPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    kind: JobKind
    document_id: uuid.UUID | None
    anchor: str | None
    skill: str | None
    skill_version: str | None
    state: JobState
    attempts: int
    error: str | None
    result: dict[str, Any] | None
    run_mode: RunMode | None
    duration_ms: int | None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None


class JobAccepted(BaseModel):
    """`202` body: the queued job, or the live one that already covers this work."""

    job: JobPublic
    deduplicated: bool

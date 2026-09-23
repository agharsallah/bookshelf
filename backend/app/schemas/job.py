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
            "examples": [{"kind": "summarize", "document_id": "…", "anchor": "ch03"}]
        },
    )

    kind: JobKind
    document_id: uuid.UUID | None = None
    anchor: Annotated[str | None, Field(default=None, max_length=200)]
    force: Annotated[
        bool, Field(default=False, description="Re-run even if an artifact for this input exists.")
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

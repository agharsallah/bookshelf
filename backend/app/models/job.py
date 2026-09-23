"""ORCHESTRATION: the jobs table doubles as the work queue (see app/jobs/queue.py)."""

import uuid
from datetime import datetime
from typing import Any

from sqlmodel import Field, SQLModel

from app.models._columns import enum_type, jsonb, timestamptz, utcnow
from app.models.enums import JobKind, JobState, RunMode


class Job(SQLModel, table=True):
    __tablename__ = "jobs"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    kind: JobKind = Field(sa_type=enum_type(JobKind))
    document_id: uuid.UUID | None = Field(
        default=None, foreign_key="documents.id", ondelete="CASCADE"
    )
    anchor: str | None = None
    skill: str | None = None
    skill_version: str | None = None
    input_hash: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict, sa_column=jsonb())
    state: JobState = Field(default=JobState.QUEUED, sa_type=enum_type(JobState))
    priority: int = 100
    attempts: int = 0
    max_attempts: int = 3
    run_after: datetime = Field(default_factory=utcnow, sa_column=timestamptz())
    locked_at: datetime | None = Field(default=None, sa_column=timestamptz(nullable=True))
    error: str | None = None
    result: dict[str, Any] | None = Field(
        default=None, sa_column=jsonb(nullable=True, server_default=None)
    )
    cost_tokens: int | None = None
    run_mode: RunMode | None = Field(default=None, sa_type=enum_type(RunMode))
    duration_ms: int | None = None
    created_at: datetime = Field(default_factory=utcnow, sa_column=timestamptz())
    started_at: datetime | None = Field(default=None, sa_column=timestamptz(nullable=True))
    finished_at: datetime | None = Field(default=None, sa_column=timestamptz(nullable=True))

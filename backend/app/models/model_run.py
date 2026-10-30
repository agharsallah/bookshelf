"""TELEMETRY: one row per CLI call a job makes (see app/telemetry/recorder.py)."""

import uuid
from datetime import datetime

from sqlmodel import Field, SQLModel

from app.models._columns import enum_type, timestamptz, utcnow
from app.models.enums import JobKind, ModelRuntime, Tier


class ModelRun(SQLModel, table=True):
    __tablename__ = "model_runs"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    job_id: uuid.UUID | None = Field(default=None, foreign_key="jobs.id", ondelete="CASCADE")
    document_id: uuid.UUID | None = Field(
        default=None, foreign_key="documents.id", ondelete="CASCADE"
    )
    kind: JobKind = Field(sa_type=enum_type(JobKind))
    runtime: ModelRuntime = Field(default=ModelRuntime.CLAUDE, sa_type=enum_type(ModelRuntime))
    skill: str | None = None
    skill_version: str | None = None
    tier: Tier | None = Field(default=None, sa_type=enum_type(Tier))
    model: str | None = None
    external_run_id: str | None = None  # Cursor session id (`agent --resume`), when cursor
    attempt: int = 1
    call: int = 1
    ok: bool
    error: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    cache_read_tokens: int | None = None
    cache_write_tokens: int | None = None
    cost_usd: float | None = None
    duration_ms: int
    api_ms: int | None = None
    turns: int | None = None
    prompt_chars: int
    reply_chars: int | None = None
    images: int = 0
    created_at: datetime = Field(default_factory=utcnow, sa_column=timestamptz())

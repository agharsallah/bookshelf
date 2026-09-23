"""DISTILLATION layer. Append-only and versioned: a re-run inserts, never updates body."""

import uuid
from datetime import datetime
from typing import Any

from sqlmodel import Field, SQLModel

from app.models._columns import enum_type, jsonb, text_array, timestamptz, utcnow
from app.models.enums import ArtifactType, Origin, Review, RunMode, Tier


class Artifact(SQLModel, table=True):
    __tablename__ = "artifacts"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    document_id: uuid.UUID = Field(foreign_key="documents.id", ondelete="CASCADE")
    anchor: str | None = None  # scope; None = whole document
    note_id: uuid.UUID | None = Field(default=None, foreign_key="notes.id", ondelete="CASCADE")
    type: ArtifactType = Field(sa_type=enum_type(ArtifactType))
    version: int
    origin: Origin = Field(sa_type=enum_type(Origin))
    skill: str | None = None
    skill_version: str | None = None
    model: str | None = None
    run_mode: RunMode | None = Field(default=None, sa_type=enum_type(RunMode))
    tier: Tier | None = Field(default=None, sa_type=enum_type(Tier))
    input_hash: str
    body: dict[str, Any] = Field(sa_column=jsonb(server_default=None))
    citations: list[str] = Field(default_factory=list, sa_column=text_array())
    gates: dict[str, Any] = Field(default_factory=dict, sa_column=jsonb())
    review: Review = Field(default=Review.DRAFT, sa_type=enum_type(Review))
    reviewed_at: datetime | None = Field(default=None, sa_column=timestamptz(nullable=True))
    created_at: datetime = Field(default_factory=utcnow, sa_column=timestamptz())

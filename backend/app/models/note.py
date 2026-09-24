"""HUMAN layer: highlights and notes. `raw` is immutable once written (D11, enforced by a
trigger); a plain highlight has no `raw` and may gain it exactly once."""

import uuid
from datetime import datetime
from typing import Any

from sqlmodel import Field, SQLModel

from app.models._columns import enum_type, jsonb, timestamptz, utcnow
from app.models.enums import NoteColor, NoteTarget


class Note(SQLModel, table=True):
    __tablename__ = "notes"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    document_id: uuid.UUID = Field(foreign_key="documents.id", ondelete="CASCADE")
    anchor: str
    range: dict[str, Any] | None = Field(
        default=None, sa_column=jsonb(nullable=True, server_default=None)
    )
    raw: str | None = None
    color: NoteColor | None = Field(default=None, sa_type=enum_type(NoteColor))
    # What the note marks: the source text, or a passage of a chapter distillation/summary
    # (then `artifact_id`, `block` and `quote` are set; `range` is into that block's text).
    target: NoteTarget = Field(default=NoteTarget.SOURCE, sa_type=enum_type(NoteTarget))
    artifact_id: uuid.UUID | None = Field(
        default=None, foreign_key="artifacts.id", ondelete="SET NULL"
    )
    block: int | None = None
    quote: str | None = None
    created_at: datetime = Field(default_factory=utcnow, sa_column=timestamptz())

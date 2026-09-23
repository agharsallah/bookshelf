"""HUMAN layer: highlights and notes. `raw` is immutable (D11, enforced by a trigger)."""

import uuid
from datetime import datetime
from typing import Any

from sqlmodel import Field, SQLModel

from app.models._columns import enum_type, jsonb, timestamptz, utcnow
from app.models.enums import NoteColor


class Note(SQLModel, table=True):
    __tablename__ = "notes"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    document_id: uuid.UUID = Field(foreign_key="documents.id", ondelete="CASCADE")
    anchor: str
    range: dict[str, Any] | None = Field(
        default=None, sa_column=jsonb(nullable=True, server_default=None)
    )
    raw: str
    color: NoteColor | None = Field(default=None, sa_type=enum_type(NoteColor))
    created_at: datetime = Field(default_factory=utcnow, sa_column=timestamptz())

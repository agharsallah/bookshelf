"""Pills (docs/PILLS.md §3): the derived `pills` and the human feed data around them."""

import uuid
from datetime import datetime
from typing import Any

from sqlmodel import Field, SQLModel

from app.models._columns import enum_type, jsonb, text_array, timestamptz, utcnow, uuid_array
from app.models.enums import PillEventKind, PillKind


class Pill(SQLModel, table=True):
    """DERIVED (D1): rebuilt by `app.pills.store.sync_document`; retired, never deleted."""

    __tablename__ = "pills"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    document_id: uuid.UUID = Field(foreign_key="documents.id", ondelete="CASCADE")
    anchor: str  # the unit (chapter or paper section) the pill belongs to
    kind: PillKind = Field(sa_type=enum_type(PillKind))
    headline: str | None = None
    body: dict[str, Any] = Field(sa_column=jsonb(server_default=None))
    cites: list[str] = Field(default_factory=list, sa_column=text_array())
    concepts: list[str] = Field(default_factory=list, sa_column=text_array())
    thread_key: str | None = None
    thread_index: int | None = None
    thread_title: str | None = None
    est_seconds: int
    origin: str  # 'harvest:<artifact_type>' | 'harvest:graph' | 'skill:make-pills@<v>'
    source_artifact_id: uuid.UUID | None = Field(
        default=None, foreign_key="artifacts.id", ondelete="SET NULL"
    )
    source_key: str = Field(unique=True)
    draft: bool = False
    created_at: datetime = Field(default_factory=utcnow, sa_column=timestamptz())
    retired_at: datetime | None = Field(default=None, sa_column=timestamptz(nullable=True))


class PillSession(SQLModel, table=True):
    __tablename__ = "pill_sessions"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    config: dict[str, Any] = Field(sa_column=jsonb(server_default=None))
    seed: int
    served: list[uuid.UUID] = Field(default_factory=list, sa_column=uuid_array())
    position: int = 0
    created_at: datetime = Field(default_factory=utcnow, sa_column=timestamptz())
    finished_at: datetime | None = Field(default=None, sa_column=timestamptz(nullable=True))


class PillEvent(SQLModel, table=True):
    __tablename__ = "pill_events"

    id: uuid.UUID = Field(primary_key=True)  # client-generated: retries are no-ops
    session_id: uuid.UUID | None = Field(
        default=None, foreign_key="pill_sessions.id", ondelete="SET NULL"
    )
    pill_id: uuid.UUID | None = Field(default=None, foreign_key="pills.id", ondelete="CASCADE")
    review_item_id: uuid.UUID | None = Field(
        default=None, foreign_key="review_items.id", ondelete="CASCADE"
    )
    kind: PillEventKind = Field(sa_type=enum_type(PillEventKind))
    value: dict[str, Any] | None = Field(
        default=None, sa_column=jsonb(nullable=True, server_default=None)
    )
    at: datetime = Field(sa_column=timestamptz())


class Feed(SQLModel, table=True):
    __tablename__ = "feeds"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    name: str
    config: dict[str, Any] = Field(sa_column=jsonb(server_default=None))
    created_at: datetime = Field(default_factory=utcnow, sa_column=timestamptz())
    updated_at: datetime = Field(default_factory=utcnow, sa_column=timestamptz())

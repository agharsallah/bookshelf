"""HUMAN layer, remembering: recalls and predictions (your words, immutable by trigger, D11),
their grades (derived, by the grade-recall skill) and the spaced-review queue."""

import uuid
from datetime import datetime
from typing import Any

from sqlmodel import Field, SQLModel

from app.models._columns import enum_type, jsonb, timestamptz, utcnow
from app.models.enums import RecallKind, ReviewSource


class Recall(SQLModel, table=True):
    __tablename__ = "recalls"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    document_id: uuid.UUID = Field(foreign_key="documents.id", ondelete="CASCADE")
    unit: str  # the chapter anchor
    kind: RecallKind = Field(sa_type=enum_type(RecallKind))
    raw: str
    created_at: datetime = Field(default_factory=utcnow, sa_column=timestamptz())


class RecallGrade(SQLModel, table=True):
    __tablename__ = "recall_grades"

    recall_id: uuid.UUID = Field(foreign_key="recalls.id", ondelete="CASCADE", primary_key=True)
    prediction_id: uuid.UUID | None = Field(
        default=None, foreign_key="recalls.id", ondelete="SET NULL"
    )
    # [{id, tier, text, cites, status, feedback, cue?}], one per key idea of the chapter
    ideas: list[dict[str, Any]] = Field(sa_column=jsonb(server_default=None))
    question: dict[str, Any] | None = Field(
        default=None, sa_column=jsonb(nullable=True, server_default=None)
    )
    comparison: dict[str, Any] | None = Field(
        default=None, sa_column=jsonb(nullable=True, server_default=None)
    )
    origin: str
    model: str | None = None
    created_at: datetime = Field(default_factory=utcnow, sa_column=timestamptz())


class ReviewItem(SQLModel, table=True):
    __tablename__ = "review_items"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    document_id: uuid.UUID = Field(foreign_key="documents.id", ondelete="CASCADE")
    anchor: str  # the passage the answer rests on
    source: ReviewSource = Field(sa_type=enum_type(ReviewSource))
    source_key: str
    prompt: str
    answer: list[dict[str, Any]] = Field(sa_column=jsonb(server_default=None))  # spans
    card: dict[str, Any] = Field(sa_column=jsonb(server_default=None))  # FSRS card state
    due: datetime = Field(sa_column=timestamptz())
    last_rating: int | None = None
    created_at: datetime = Field(default_factory=utcnow, sa_column=timestamptz())


class ReviewLog(SQLModel, table=True):
    __tablename__ = "review_logs"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    item_id: uuid.UUID = Field(foreign_key="review_items.id", ondelete="CASCADE")
    rating: int
    answer: str | None = None  # what you typed before the reveal; None for a flashcard mark
    reviewed_at: datetime = Field(default_factory=utcnow, sa_column=timestamptz())

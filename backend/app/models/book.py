"""Persistence models. These are the database shape, never the wire shape."""

from datetime import UTC, date, datetime
from enum import StrEnum

from sqlalchemy import JSON, Column
from sqlmodel import Field, SQLModel


class ReadingStatus(StrEnum):
    WANT_TO_READ = "want_to_read"
    READING = "reading"
    FINISHED = "finished"
    ABANDONED = "abandoned"


def _utcnow() -> datetime:
    return datetime.now(UTC)


class Book(SQLModel, table=True):
    __tablename__ = "books"

    id: int | None = Field(default=None, primary_key=True)
    title: str = Field(index=True, max_length=300)
    author: str = Field(index=True, max_length=200)
    status: ReadingStatus = Field(default=ReadingStatus.WANT_TO_READ, index=True)
    rating: int | None = Field(default=None, ge=1, le=5)
    source_url: str | None = Field(default=None, max_length=2000)
    summary: str | None = Field(default=None, max_length=10_000)
    tags: list[str] = Field(default_factory=list, sa_column=Column(JSON, nullable=False))
    started_on: date | None = Field(default=None)
    finished_on: date | None = Field(default=None)
    created_at: datetime = Field(default_factory=_utcnow, index=True)
    updated_at: datetime = Field(default_factory=_utcnow)

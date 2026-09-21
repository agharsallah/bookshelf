"""Request/response models for books.

Separate from the table model on purpose: clients never get to set `id`, timestamps,
or any column added later. `extra="forbid"` turns a typo in a payload into a 422
instead of a silently ignored field.

Docs: https://fastapi.tiangolo.com/tutorial/response-model/
"""

from datetime import date, datetime
from typing import Annotated, Self

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, model_validator

from app.models.book import ReadingStatus

Title = Annotated[str, Field(min_length=1, max_length=300, description="Book title.")]
Author = Annotated[str, Field(min_length=1, max_length=200, description="Primary author.")]
Rating = Annotated[int | None, Field(default=None, ge=1, le=5, description="1-5 stars.")]
Summary = Annotated[
    str | None,
    Field(default=None, max_length=10_000, description="Your distillation of the book."),
]
Tags = Annotated[
    list[Annotated[str, Field(min_length=1, max_length=40)]],
    Field(default_factory=list, max_length=20, description="Free-form labels."),
]


class _BookBase(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class BookCreate(_BookBase):
    model_config = ConfigDict(
        extra="forbid",
        str_strip_whitespace=True,
        json_schema_extra={
            "examples": [
                {
                    "title": "Thinking in Systems",
                    "author": "Donella Meadows",
                    "status": "reading",
                    "tags": ["systems", "mental-models"],
                    "started_on": "2026-09-01",
                }
            ]
        },
    )

    title: Title
    author: Author
    status: ReadingStatus = ReadingStatus.WANT_TO_READ
    rating: Rating
    source_url: HttpUrl | None = None
    summary: Summary
    tags: Tags
    started_on: date | None = None
    finished_on: date | None = None

    @model_validator(mode="after")
    def _dates_must_make_sense(self) -> Self:
        if self.started_on and self.finished_on and self.finished_on < self.started_on:
            raise ValueError("finished_on cannot be earlier than started_on")
        return self


class BookUpdate(_BookBase):
    """PATCH body. Every field optional; omitted fields are left untouched."""

    title: Annotated[str | None, Field(default=None, min_length=1, max_length=300)]
    author: Annotated[str | None, Field(default=None, min_length=1, max_length=200)]
    status: ReadingStatus | None = None
    rating: Rating
    source_url: HttpUrl | None = None
    summary: Summary
    tags: Annotated[list[str] | None, Field(default=None, max_length=20)]
    started_on: date | None = None
    finished_on: date | None = None


class BookPublic(BaseModel):
    """What leaves the API. Built from the table model via `model_validate`."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    author: str
    status: ReadingStatus
    rating: int | None
    source_url: str | None
    summary: str | None
    tags: list[str]
    started_on: date | None
    finished_on: date | None
    created_at: datetime
    updated_at: datetime

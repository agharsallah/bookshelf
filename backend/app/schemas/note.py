"""Wire shapes for notes (§9 "Your notes"). `raw` is set once and never edited (D11)."""

import uuid
from datetime import datetime
from typing import Annotated, Any, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.enums import NoteColor, Review
from app.schemas.job import JobPublic
from app.schemas.node import Anchor
from app.services.notes import NoteView


class NoteRange(BaseModel):
    """Character offsets into the node's `text`: `0 <= start < end <= len(text)`."""

    model_config = ConfigDict(extra="forbid")

    start: Annotated[int, Field(ge=0)]
    end: Annotated[int, Field(gt=0)]

    @model_validator(mode="after")
    def _start_before_end(self) -> Self:
        if self.start >= self.end:
            raise ValueError("range.start must be less than range.end.")
        return self


class NoteCreate(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={
            "examples": [
                {
                    "document_id": "3f1c…",
                    "anchor": "ch03/s02/p014",
                    "range": {"start": 12, "end": 58},
                    "raw": "This is the delay argument again.",
                    "color": "amber",
                }
            ]
        },
    )

    document_id: uuid.UUID
    anchor: Anchor
    range: NoteRange | None = None
    raw: Annotated[str, Field(min_length=1, max_length=20_000)]
    color: NoteColor | None = None


class NoteUpdate(BaseModel):
    """Only `color` is editable (`null` clears it)."""

    model_config = ConfigDict(extra="forbid")

    color: NoteColor | None

    @model_validator(mode="before")
    @classmethod
    def _raw_is_immutable(cls, data: Any) -> Any:
        if isinstance(data, dict) and "raw" in data:
            raise ValueError(
                "`raw` is immutable (D11): your words are never rewritten. "
                "Delete the note and create a new one instead."
            )
        return data


class NotePublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    document_id: uuid.UUID
    anchor: str
    range: dict[str, int] | None
    raw: str
    color: NoteColor | None
    created_at: datetime


class StructuredNotePublic(BaseModel):
    """The newest `structured_note` artifact for a note."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    version: int
    review: Review
    skill_version: str | None
    body: dict[str, Any]
    created_at: datetime


class NoteDetail(NotePublic):
    structured: StructuredNotePublic | None
    detached: Annotated[
        bool, Field(description="True when the anchor no longer exists after a re-parse.")
    ]

    @classmethod
    def from_view(cls, view: NoteView) -> Self:
        return cls.model_validate(
            {
                **NotePublic.model_validate(view.note).model_dump(),
                "structured": StructuredNotePublic.model_validate(view.structured)
                if view.structured
                else None,
                "detached": view.detached,
            }
        )


class NoteCreated(NotePublic):
    """`201` body: the note as stored, plus the queued `structure_note` job."""

    job: JobPublic

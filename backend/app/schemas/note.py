"""Wire shapes for notes (§9 "Your notes"). `raw` is set once and never edited (D11); a
plain highlight has no `raw` and may gain it exactly once."""

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
    raw: Annotated[
        str | None,
        Field(
            min_length=1,
            max_length=20_000,
            description="Your words. Omit (or null) for a plain highlight: no model call.",
        ),
    ] = None
    color: NoteColor | None = None


class NoteUpdate(BaseModel):
    """`color` (`null` clears it), and `raw` only to give a plain highlight its words once:
    a note that already has words answers `409` (D11)."""

    model_config = ConfigDict(extra="forbid")

    color: NoteColor | None = None
    raw: Annotated[str, Field(min_length=1, max_length=20_000)] | None = None

    @model_validator(mode="after")
    def _something_to_change(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("Send `color` and/or `raw`.")
        if "raw" in self.model_fields_set and self.raw is None:
            raise ValueError("`raw` cannot be removed (D11).")
        return self


class NotePublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    document_id: uuid.UUID
    anchor: str
    range: dict[str, int] | None
    raw: str | None
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
    """`201` body: the note as stored, plus its `structure_note` job (null for a highlight)."""

    job: JobPublic | None

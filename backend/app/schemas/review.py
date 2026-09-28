"""Wire shapes for spaced reviews. A due card never carries its answer: it is revealed only
for a typed attempt (`POST /reviews/{id}/reveal`)."""

import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import ReviewSource
from app.services.reviews import DueItem

Attempt = Annotated[
    str,
    Field(min_length=1, max_length=20000, description="What you typed before the reveal."),
]
FlashcardMark = Literal["knew", "learning"]


class ReviewBook(BaseModel):
    id: uuid.UUID
    slug: str
    title: str


class DueCard(BaseModel):
    """A review item waiting for you: the prompt only."""

    id: uuid.UUID
    document: ReviewBook
    anchor: Annotated[str, Field(description="The passage the answer rests on.")]
    source: ReviewSource
    prompt: str
    due: datetime

    @classmethod
    def from_due(cls, due: DueItem) -> "DueCard":
        doc = due.document
        item = due.item
        return cls(
            id=item.id,
            document=ReviewBook(id=doc.id, slug=doc.slug, title=doc.title),
            anchor=item.anchor,
            source=item.source,
            prompt=item.prompt,
            due=item.due,
        )


class DueCards(BaseModel):
    items: list[DueCard]
    total: Annotated[int, Field(ge=0, description="Every item due, across all books.")]


class RevealRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    answer: Attempt


class Revealed(BaseModel):
    id: uuid.UUID
    anchor: str
    answer: Annotated[
        list[dict[str, Any]], Field(description="The cited answer, as spans `{text, cites}`.")
    ]


class RatingRequest(BaseModel):
    model_config = ConfigDict(
        extra="forbid", json_schema_extra={"examples": [{"rating": 3, "answer": "Because…"}]}
    )

    rating: Annotated[int, Field(ge=1, le=4, description="1 again · 2 hard · 3 good · 4 easy.")]
    answer: Attempt


class Rated(BaseModel):
    id: uuid.UUID
    due: Annotated[datetime, Field(description="When it comes back.")]
    last_rating: int


class MarkRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mark: FlashcardMark


class FlashcardMarks(BaseModel):
    marks: Annotated[
        dict[int, FlashcardMark], Field(description="Card index → your last mark on it.")
    ]

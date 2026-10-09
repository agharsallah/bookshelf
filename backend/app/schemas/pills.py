"""Pills API bodies (docs/PILLS.md §7). The pill itself is `app.pills.contract.PillOut`."""

import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.enums import PillEventKind
from app.pills.contract import Anchor, DocumentRef, PillOut
from app.pills.feed.config import FeedConfig

MAX_EVENTS = 200


class RebuildRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document: Annotated[
        str | None,
        Field(max_length=200, description="One document's uuid or slug; omitted: every document."),
    ] = None


class JobsQueued(BaseModel):
    jobs: list[uuid.UUID]


# --- Feed (docs/PILLS.md §6, §7) ---------------------------------------------------------


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SessionOut(BaseModel):
    """A session as clients see it (the served list stays server-side)."""

    id: uuid.UUID
    config: FeedConfig
    seed: int
    position: Annotated[int, Field(description="Index in the served list to resume from.")]
    created_at: datetime
    finished_at: datetime | None


class Generatable(BaseModel):
    anchor: str
    title: str | None
    estimate_tokens: int | None


class SupplyDocument(BaseModel):
    document: DocumentRef
    unseen: int
    generatable: Annotated[
        list[Generatable],
        Field(description="Units with a chapter distillation and no pill_set yet."),
    ]
    undistilled: Annotated[bool, Field(description="No distillation: no pills can be made.")]


class Supply(BaseModel):
    unseen: int
    by_document: list[SupplyDocument]
    low: Annotated[bool, Field(description="Fewer unseen pills than the low-water mark (30).")]


class SessionPage(BaseModel):
    pills: list[PillOut]
    next_cursor: Annotated[str | None, Field(description="Opaque; null when nothing is left.")]


class SessionStart(BaseModel):
    session: SessionOut
    page: SessionPage
    supply: Supply
    notice: str | None = None


class SessionContinuation(SessionPage):
    supply: Supply
    done: Annotated[bool, Field(description="The session's length is reached, or it ran dry.")]
    notice: str | None = None


class StartRequest(_Strict):
    config: FeedConfig | None = None
    feed_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def _one_of(self) -> "StartRequest":
        if (self.config is None) == (self.feed_id is None):
            raise ValueError("Give either `config` or `feed_id`.")
        return self


class NextRead(BaseModel):
    document: DocumentRef
    anchor: str
    title: str | None = None


class Summary(BaseModel):
    seen: int
    saved: int
    answered: int
    correct: int
    due_tomorrow: int
    minutes: int
    next_read: NextRead | None = None


class Finished(BaseModel):
    summary: Summary


class EventIn(_Strict):
    id: uuid.UUID
    session_id: uuid.UUID | None = None
    pill_id: uuid.UUID | None = None
    review_item_id: uuid.UUID | None = None
    kind: PillEventKind
    value: dict[str, Any] | None = None
    at: datetime

    @model_validator(mode="after")
    def _has_target(self) -> "EventIn":
        if self.pill_id is None and self.review_item_id is None:
            raise ValueError("An event needs a `pill_id` or a `review_item_id`.")
        return self


class EventsRequest(_Strict):
    events: Annotated[list[EventIn], Field(min_length=1, max_length=MAX_EVENTS)]


class EventsResult(BaseModel):
    accepted: int
    duplicates: Annotated[int, Field(description="Ids already recorded (retries): no-ops.")]
    ignored: Annotated[
        int, Field(description="Events on a pill or review item that no longer exists.")
    ] = 0


class GenerateRequest(_Strict):
    document: Annotated[str, Field(min_length=1, max_length=200, description="uuid or slug")]
    anchors: Annotated[list[Anchor], Field(max_length=50)] | None = None
    style: Literal["plain", "story", "socratic"] | None = None


class GenerateResult(BaseModel):
    jobs: list[uuid.UUID]
    estimate_tokens: int | None


class FeedCreate(_Strict):
    name: Annotated[str, Field(min_length=1, max_length=120)]
    config: FeedConfig


class FeedPatch(_Strict):
    name: Annotated[str, Field(min_length=1, max_length=120)] | None = None
    config: FeedConfig | None = None


class FeedOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    config: FeedConfig
    created_at: datetime
    updated_at: datetime


class FeedList(BaseModel):
    items: list[FeedOut]

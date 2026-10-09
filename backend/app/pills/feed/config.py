"""`FeedConfig` (docs/PILLS.md §6): what a feed draws from, how, and for how long.

Sources name documents and collections by uuid or slug, paper sets by uuid or name, and
concepts by uuid or name (the frontend sends whichever it has). All empty: the whole shelf.
A config is stored as JSON on sessions and saved feeds, and travels in `?config=<json>`.
"""

import json
from enum import StrEnum
from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.models.enums import Genre, PillKind
from app.services.errors import InvalidInputError

Ref = Annotated[str, Field(min_length=1, max_length=200)]
Refs = Annotated[list[Ref], Field(max_length=100)]


class FeedMode(StrEnum):
    CONSOLIDATE = "consolidate"  # units you have read
    PREVIEW = "preview"  # the next unread units, active kinds only
    EXPLORE = "explore"  # everything (spoilers honoured)
    REVIEW = "review"  # due review items only


class FeedSources(BaseModel):
    model_config = ConfigDict(extra="forbid")

    documents: Refs = []
    collections: Refs = []
    paper_sets: Refs = []
    concepts: Refs = []
    genre: Genre | None = None

    @property
    def whole_shelf(self) -> bool:
        return not (self.documents or self.collections or self.paper_sets or self.concepts)


class FeedConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sources: FeedSources = Field(default_factory=FeedSources)
    mode: FeedMode = FeedMode.CONSOLIDATE
    kinds: Annotated[list[PillKind], Field(min_length=1)] | None = None  # None: every kind
    length: Annotated[int, Field(ge=1, le=200)] | None = 20  # pills per session; None: endless
    spoilers: bool = False

    def allows(self, kind: PillKind) -> bool:
        return self.kinds is None or kind in self.kinds

    def as_json(self) -> dict[str, Any]:
        return self.model_dump(mode="json")


def parse_config(raw: str | None, *, field: str = "query.config") -> FeedConfig:
    """A config from its JSON text (`?config=`); the default config when absent."""
    if raw is None or not raw.strip():
        return FeedConfig()
    try:
        return FeedConfig.model_validate(json.loads(raw))
    except (json.JSONDecodeError, ValidationError) as exc:
        raise InvalidInputError(f"Not a feed config: {exc}", field=field) from exc

"""The rows reader statistics are computed from, detached from the ORM (`collect` loads them).

Every timestamp is UTC as stored; `clock` turns them into local days and hours.
"""

import uuid
from dataclasses import dataclass
from datetime import datetime

from app.models.enums import Surface

FINISHED = 0.97  # as the frontend's `reading.ts`: the last lines rarely cross the reading line


@dataclass(frozen=True, slots=True)
class MinuteFact:
    """One `activity_minutes` row."""

    minute: datetime
    surface: Surface
    document_id: uuid.UUID | None
    unit: str
    anchor: str
    detail: str
    seconds: int


@dataclass(frozen=True, slots=True)
class ChapterFact:
    anchor: str
    title: str
    position: int
    words: int
    page_from: int | None
    page_to: int | None
    front_matter: bool = False

    @property
    def pages(self) -> int | None:
        if self.page_from is None or self.page_to is None or self.page_to < self.page_from:
            return None
        return self.page_to - self.page_from + 1


@dataclass(frozen=True, slots=True)
class BookFact:
    id: uuid.UUID
    slug: str
    title: str
    authors: tuple[str, ...]
    pages: int | None
    created_at: datetime
    chapters: tuple[ChapterFact, ...] = ()

    @property
    def words(self) -> int:
        return sum(c.words for c in self.chapters)


@dataclass(frozen=True, slots=True)
class PositionFact:
    document_id: uuid.UUID
    unit: str
    progress: float
    updated_at: datetime

    @property
    def finished(self) -> bool:
        return self.progress >= FINISHED


@dataclass(frozen=True, slots=True)
class NoteFact:
    document_id: uuid.UUID
    anchor: str
    color: str | None
    target: str
    words: int  # 0: a plain highlight
    created_at: datetime

    @property
    def highlight(self) -> bool:
        return self.words == 0


@dataclass(frozen=True, slots=True)
class RecallFact:
    document_id: uuid.UUID
    unit: str
    kind: str  # recall · prediction
    words: int
    created_at: datetime
    statuses: tuple[str, ...] | None = None  # one per key idea, when graded

    @property
    def score(self) -> float | None:
        """Recalled ideas plus half the partial ones, over all of them."""
        if not self.statuses:
            return None
        got = sum(1.0 if s == "recalled" else 0.5 if s == "partial" else 0.0 for s in self.statuses)
        return got / len(self.statuses)


@dataclass(frozen=True, slots=True)
class ReviewFact:
    document_id: uuid.UUID
    anchor: str
    source: str
    rating: int  # 1 again · 2 hard · 3 good · 4 easy
    reviewed_at: datetime


@dataclass(frozen=True, slots=True)
class CardFact:
    document_id: uuid.UUID
    source: str
    due: datetime
    state: int | None  # FSRS: 1 learning · 2 review · 3 relearning
    stability: float | None


@dataclass(frozen=True, slots=True)
class MentionFact:
    """A passage (chapter, section or block) that mentions or defines a concept."""

    document_id: uuid.UUID
    anchor: str
    concept_id: uuid.UUID
    name: str
    kind: str


@dataclass(frozen=True, slots=True)
class Facts:
    books: tuple[BookFact, ...]
    minutes: tuple[MinuteFact, ...] = ()
    positions: tuple[PositionFact, ...] = ()
    notes: tuple[NoteFact, ...] = ()
    recalls: tuple[RecallFact, ...] = ()
    reviews: tuple[ReviewFact, ...] = ()
    cards: tuple[CardFact, ...] = ()
    mentions: tuple[MentionFact, ...] = ()

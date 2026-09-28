"""Fact builders for the pure reader statistics tests: working defaults, keyword overrides."""

import uuid
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from app.models.enums import Surface
from app.reader_stats.clock import Clock
from app.reader_stats.facts import (
    BookFact,
    CardFact,
    ChapterFact,
    MinuteFact,
    NoteFact,
    PositionFact,
    RecallFact,
    ReviewFact,
)

T0 = datetime(2026, 9, 1, 9, 0, tzinfo=UTC)  # a Tuesday
BOOK = uuid.UUID(int=1)


def at(minutes: float = 0, days: float = 0) -> datetime:
    return T0 + timedelta(days=days, minutes=minutes)


def clock(now: datetime = T0, tz: str = "UTC") -> Clock:
    return Clock(tz=ZoneInfo(tz), now=now)


def minute(offset: float = 0, **overrides: Any) -> MinuteFact:
    fact = MinuteFact(
        minute=at(offset), surface=Surface.READ, document_id=BOOK, unit="ch01",
        anchor="ch01/p001", detail="", seconds=60,
    )  # fmt: skip
    return replace(fact, **overrides)


def minutes(count: int, start: float = 0, **overrides: Any) -> list[MinuteFact]:
    """`count` full consecutive minutes from `start`."""
    return [minute(start + i, **overrides) for i in range(count)]


def chapter(
    anchor: str = "ch01", *, words: int = 3000, position: int = 0, **overrides: Any
) -> ChapterFact:
    fact = ChapterFact(
        anchor=anchor, title=f"Chapter {anchor}", position=position, words=words,
        page_from=1, page_to=10,
    )  # fmt: skip
    return replace(fact, **overrides)


def book(*chapters: ChapterFact, **overrides: Any) -> BookFact:
    fact = BookFact(
        id=BOOK, slug="book", title="The Book", authors=("A. Author",), pages=100,
        created_at=T0, chapters=chapters or (chapter(),),
    )  # fmt: skip
    return replace(fact, **overrides)


def position(unit: str = "ch01", progress: float = 0.5, **overrides: Any) -> PositionFact:
    return replace(PositionFact(BOOK, unit, progress, T0), **overrides)


def note(anchor: str = "ch01/p001", words: int = 5, **overrides: Any) -> NoteFact:
    return replace(NoteFact(BOOK, anchor, "amber", "source", words, T0), **overrides)


def recall(
    statuses: tuple[str, ...] | None = ("recalled", "missed"), **overrides: Any
) -> RecallFact:
    return replace(RecallFact(BOOK, "ch01", "recall", 120, T0, statuses), **overrides)


def review(rating: int = 3, **overrides: Any) -> ReviewFact:
    return replace(ReviewFact(BOOK, "ch01/p001", "recall", rating, T0), **overrides)


def card(due: datetime = T0, **overrides: Any) -> CardFact:
    return replace(CardFact(BOOK, "recall", due, 2, 4.0), **overrides)

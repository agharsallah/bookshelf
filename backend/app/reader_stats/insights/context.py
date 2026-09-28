"""What every reader insight rule reads (`Context`) and the thresholds it compares against."""

from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field
from datetime import datetime

from app.reader_stats.attention import Sitting
from app.reader_stats.clock import Clock
from app.schemas.reader_stats import (
    BookRow,
    ChapterRow,
    HourCell,
    MemoryStats,
    NoteStats,
    PassageRow,
    ReaderInsight,
    SurfaceTime,
    Totals,
)

HOUR = 3600


@dataclass(frozen=True, slots=True)
class Thresholds:
    min_tracked_seconds: int = 2 * HOUR  # before habits (hours, weekdays) mean anything
    peak_window_hours: int = 4
    peak_share: float = 0.4
    weekday_share: float = 0.3
    streak_praise: int = 3
    short_session_seconds: int = 10 * 60
    min_sessions: int = 5
    listening_share: float = 0.3
    new_tracking_days: int = 7
    almost_done: float = 0.8
    many_open_books: int = 3
    slow_pace: float = 1.6
    fast_pace: float = 0.5
    chapter_limit: int = 3
    revisits: int = 3
    unannotated_chapters: int = 3
    min_highlights: int = 10
    note_to_highlight: float = 0.2
    unrecalled_chapters: int = 3
    missed_share: float = 0.3
    min_recalls: int = 3
    due_backlog: int = 10
    min_reviews: int = 20
    retention_floor: float = 0.8


@dataclass(frozen=True, slots=True)
class Context:
    clock: Clock
    totals: Totals
    surfaces: Sequence[SurfaceTime]
    hours: Sequence[HourCell]
    sittings: Sequence[Sitting]
    books: Sequence[BookRow]
    chapters: Sequence[ChapterRow]
    passages: Sequence[PassageRow]
    notes: NoteStats
    memory: MemoryStats
    tracked_since: datetime | None
    book: str | None = None  # the book's slug, when the view is one book
    limits: Thresholds = field(default_factory=Thresholds)


Rule = Callable[[Context], Iterable[ReaderInsight]]


def pct(value: float) -> str:
    return f"{value:.0%}"


def hours_label(seconds: float) -> str:
    if seconds < HOUR:
        return f"{round(seconds / 60)} min"
    return f"{seconds / HOUR:.1f} h"


def read_href(document: str, anchor: str) -> str:
    return f"/documents/{document}/read/{anchor}"

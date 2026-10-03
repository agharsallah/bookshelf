"""Assemble `LibraryReaderStats` (every book) and `BookReaderStats` (one book) from the facts
`collect` loads. The one place reader statistics touch the database session."""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime

from sqlmodel import Session

from app.models import Document
from app.models.enums import Surface
from app.reader_stats import attention, books, collect, memory, notes, passages
from app.reader_stats.clock import Clock, zone
from app.reader_stats.concepts import concept_rows
from app.reader_stats.facts import FINISHED, Facts
from app.reader_stats.insights import Context, insights
from app.reader_stats.numbers import median, ratio, rounded
from app.schemas.reader_stats import (
    BookReaderStats,
    BookRow,
    BookState,
    ChapterRow,
    Depth,
    DepthCount,
    LibraryReaderStats,
    ReaderStats,
    Totals,
)

STUDY = (Surface.STUDY, Surface.RECALL, Surface.REVIEW)


@dataclass(frozen=True, slots=True)
class Window:
    tz: str = "UTC"
    days: int | None = None


def _totals(
    facts: Facts,
    clock: Clock,
    since: datetime,
    book_rows: Sequence[BookRow],
    chapters: Sequence[ChapterRow],
    sittings: Sequence[attention.Sitting],
    history: set[date],
) -> Totals:
    seconds = attention.by_surface(facts.minutes)
    days = attention.active_days(facts, clock, clock.day(since))
    current, longest = attention.streaks(history, clock.today)
    lengths = [s.seconds for s in sittings]
    reviews = facts.reviews
    words_read = sum(b.words * b.progress for b in book_rows)
    pages_read = sum((b.pages or 0) * b.progress for b in book_rows)
    written = [n for n in facts.notes if not n.highlight]
    return Totals(
        seconds=sum(seconds.values()),
        reading_seconds=seconds.get(Surface.READ, 0),
        listening_seconds=seconds.get(Surface.LISTEN, 0),
        study_seconds=sum(seconds.get(s, 0) for s in STUDY),
        active_days=len(days),
        sessions=len(sittings),
        mean_session_seconds=round(sum(lengths) / len(lengths)) if lengths else None,
        median_session_seconds=round(m) if (m := median(lengths)) is not None else None,
        longest_session_seconds=max(lengths, default=None),
        current_streak=current,
        longest_streak=longest,
        books_started=sum(1 for b in book_rows if Depth.OPENED in b.depth),
        books_finished=sum(1 for b in book_rows if b.state is BookState.FINISHED),
        chapters_finished=sum(1 for c in chapters if c.progress >= FINISHED),
        words_read=round(words_read),
        pages_read=round(pages_read),
        words_per_minute=books.reading_speed(chapters),
        notes=len(written),
        highlights=len(facts.notes) - len(written),
        words_written=sum(n.words for n in written) + sum(r.words for r in facts.recalls),
        recalls=sum(1 for r in facts.recalls if r.kind == "recall"),
        predictions=sum(1 for r in facts.recalls if r.kind == "prediction"),
        reviews=len(reviews),
        retention=rounded(ratio(sum(1 for r in reviews if r.rating > 1), len(reviews)), 3),
    )


def _depth(rows: Sequence[BookRow]) -> list[DepthCount]:
    return [DepthCount(depth=d, books=sum(1 for b in rows if d in b.depth)) for d in Depth]


def _build(
    session: Session, window: Window, document_id: uuid.UUID | None, now: datetime | None
) -> tuple[ReaderStats, list[BookRow]]:
    clock = Clock(tz=zone(window.tz), now=now or datetime.now(UTC))
    since = clock.since(window.days)
    facts = collect.load(session, since=since, document_id=document_id)

    def texts(blocks: Sequence[passages.Block]) -> dict[passages.Block, str]:
        return collect.texts(session, blocks)

    chapters = books.chapter_rows(facts, clock)
    book_rows = books.book_rows(facts, chapters, clock)
    sittings = attention.sittings(facts.minutes)
    slugs = {b.id: b.slug for b in facts.books}
    # All history for streaks unless the window already holds it.
    history = (
        collect.active_dates(session, window.tz, document_id)
        if window.days is not None
        else attention.active_days(facts, clock)
    )
    totals = _totals(facts, clock, since, book_rows, chapters, sittings, history)
    surfaces = attention.surfaces(facts.minutes)
    hours = attention.hours(facts.minutes, clock)
    visited = passages.visited(facts, clock, texts)
    note_stats = notes.note_stats(facts, chapters)
    memory_stats = memory.memory_stats(facts, clock)
    tracked_since = collect.tracked_since(session, document_id)
    context = Context(
        clock=clock, totals=totals, surfaces=surfaces, hours=hours, sittings=sittings,
        books=book_rows, chapters=chapters, passages=visited, notes=note_stats,
        memory=memory_stats, tracked_since=tracked_since,
        book=facts.books[0].slug if document_id and facts.books else None,
    )  # fmt: skip
    shared = ReaderStats(
        generated_at=clock.now,
        tz=window.tz,
        days=window.days,
        tracked_since=tracked_since,
        totals=totals,
        surfaces=surfaces,
        daily=attention.daily(facts, clock, clock.day(since)),
        hours=hours,
        session_lengths=attention.session_lengths(sittings),
        sessions=attention.recent_sessions(sittings, slugs),
        chapters=chapters,
        passages=visited,
        annotated=passages.annotated(facts, clock, texts),
        notes=note_stats,
        memory=memory_stats,
        concepts=concept_rows(facts),
        insights=insights(context),
    )
    return shared, book_rows


def library_stats(
    session: Session, window: Window, *, now: datetime | None = None
) -> LibraryReaderStats:
    shared, rows = _build(session, window, None, now)
    ordered = sorted(rows, key=lambda b: (b.last_seen is None, -(b.last_seen or _MIN).timestamp()))
    return LibraryReaderStats(**dict(shared), books=ordered, depth=_depth(rows))


def book_stats(
    session: Session, document: Document, window: Window, *, now: datetime | None = None
) -> BookReaderStats:
    shared, rows = _build(session, window, document.id, now)
    return BookReaderStats(**dict(shared), book=rows[0])


_MIN = datetime.min.replace(tzinfo=UTC)

__all__ = ["ReaderStats", "Window", "book_stats", "library_stats"]

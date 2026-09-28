"""Per book and per chapter: progress, time, pace, notes, recall and review.

Words read are each chapter's words times the furthest point reached in it. Reading speed
only counts chapters with both reading time and progress (`MIN_READ_SECONDS`), so a chapter
you only listened to, or opened for a second, does not skew it.
"""

import uuid
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from app.models.enums import Surface
from app.reader_stats.clock import Clock
from app.reader_stats.facts import BookFact, ChapterFact, Facts, MinuteFact, PositionFact
from app.reader_stats.numbers import median, ratio, rounded
from app.schemas.reader_stats import BookRow, BookState, ChapterRow, Depth

MIN_READ_SECONDS = 120
STALLED_AFTER = timedelta(days=21)
READ_DEPTH = 0.25  # a quarter of the book counts as having read it
STUDY_SURFACES = frozenset({Surface.STUDY, Surface.RECALL, Surface.REVIEW})


def under(anchor: str, unit: str) -> bool:
    return anchor == unit or anchor.startswith(f"{unit}/")


@dataclass(slots=True)
class _Tally:
    """What happened in one chapter (or, keyed by document only, one book)."""

    seconds: dict[Surface, int] = field(default_factory=lambda: defaultdict(int))
    days: set[object] = field(default_factory=set)
    notes: int = 0
    highlights: int = 0
    last_seen: datetime | None = None

    def seen(self, at: datetime) -> None:
        if self.last_seen is None or at > self.last_seen:
            self.last_seen = at


def _unit_of(anchor: str, chapters: Sequence[ChapterFact]) -> str | None:
    for chapter in chapters:
        if under(anchor, chapter.anchor):
            return chapter.anchor
    return None


def _chapter_tallies(facts: Facts, clock: Clock) -> dict[tuple[uuid.UUID, str], _Tally]:
    chapters = {b.id: b.chapters for b in facts.books}
    tallies: dict[tuple[uuid.UUID, str], _Tally] = defaultdict(_Tally)
    for m in facts.minutes:
        if m.document_id is None:
            continue
        # The chapter the place is in: a section read aloud counts for its chapter.
        unit = _unit_of(m.unit or m.anchor, chapters.get(m.document_id, ())) or m.unit
        if not unit:
            continue
        t = tallies[(m.document_id, unit)]
        t.seconds[m.surface] += m.seconds
        t.days.add(clock.day(m.minute))
        t.seen(m.minute)
    for n in facts.notes:
        noted = _unit_of(n.anchor, chapters.get(n.document_id, ()))
        if noted is None:
            continue
        t = tallies[(n.document_id, noted)]
        if n.highlight:
            t.highlights += 1
        else:
            t.notes += 1
        t.seen(n.created_at)
    return tallies


def _latest_scores(facts: Facts) -> dict[tuple[uuid.UUID, str], float]:
    latest: dict[tuple[uuid.UUID, str], tuple[datetime, float]] = {}
    for r in facts.recalls:
        score = r.score
        key = (r.document_id, r.unit)
        if (
            r.kind == "recall"
            and score is not None
            and (key not in latest or r.created_at > latest[key][0])
        ):
            latest[key] = (r.created_at, score)
    return {k: v[1] for k, v in latest.items()}


def _wpm(words: float, seconds: int) -> float | None:
    if seconds < MIN_READ_SECONDS or words <= 0:
        return None
    return words / (seconds / 60)


def chapter_rows(facts: Facts, clock: Clock) -> list[ChapterRow]:
    """Every chapter with time, progress, notes or a recall, in reading order per book."""
    tallies = _chapter_tallies(facts, clock)
    positions = {(p.document_id, p.unit): p for p in facts.positions}
    scores = _latest_scores(facts)
    rows: list[ChapterRow] = []
    for book in facts.books:
        for c in book.chapters:
            key = (book.id, c.anchor)
            t, position = tallies.get(key), positions.get(key)
            if t is None and position is None and key not in scores:
                continue
            t = t or _Tally()
            progress = position.progress if position else 0.0
            read = t.seconds.get(Surface.READ, 0)
            other = sum(v for s, v in t.seconds.items() if s in STUDY_SURFACES)
            seen = (t.last_seen, position.updated_at if position else None)
            last = max((x for x in seen if x is not None), default=None)
            rows.append(
                ChapterRow(
                    document=book.slug,
                    book_title=book.title,
                    anchor=c.anchor,
                    title=c.title,
                    position=c.position,
                    words=c.words,
                    pages=c.pages,
                    progress=round(progress, 3),
                    read_seconds=read,
                    listen_seconds=t.seconds.get(Surface.LISTEN, 0),
                    other_seconds=other,
                    visits=len(t.days),
                    notes=t.notes,
                    highlights=t.highlights,
                    recall_score=rounded(scores.get(key), 3),
                    words_per_minute=rounded(_wpm(c.words * progress, read), 1),
                    last_seen=last,
                )
            )
    usual = median([r.words_per_minute for r in rows if r.words_per_minute])
    for row in rows:
        if usual and row.words_per_minute:
            row.pace = round(usual / row.words_per_minute, 2)
    return rows


def reading_speed(chapters: Sequence[ChapterRow]) -> float | None:
    """Words read over reading minutes, across the chapters that count for speed."""
    counted = [c for c in chapters if c.words_per_minute is not None]
    words = sum(c.words * c.progress for c in counted)
    minutes = sum(c.read_seconds for c in counted) / 60
    return rounded(ratio(words, minutes), 1)


def book_progress(book: BookFact, positions: Sequence[PositionFact]) -> tuple[float, int, int]:
    """(share of the book's words read, chapters finished, chapters counted)."""
    at = {p.unit: p for p in positions if p.document_id == book.id}
    counted = [c for c in book.chapters if not c.front_matter or c.anchor in at]
    words = sum(c.words for c in counted)
    read = sum(c.words * (1.0 if at[c.anchor].finished else at[c.anchor].progress)
               for c in counted if c.anchor in at)  # fmt: skip
    finished = sum(1 for c in counted if c.anchor in at and at[c.anchor].finished)
    return (read / words if words else 0.0), finished, len(counted)


def _state(
    progress: float, finished: int, total: int, last: datetime | None, now: datetime
) -> BookState:
    if total and finished == total:
        return BookState.FINISHED
    if last is None and progress == 0:
        return BookState.UNREAD
    if last is not None and now - last > STALLED_AFTER:
        return BookState.STALLED
    return BookState.READING


def _depth(progress: float, seen: bool, notes: int, recalls: int, reviews: int) -> list[Depth]:
    reached = [
        (Depth.OPENED, seen), (Depth.READ, progress >= READ_DEPTH), (Depth.ANNOTATED, notes > 0),
        (Depth.RECALLED, recalls > 0), (Depth.REVIEWED, reviews > 0),
    ]  # fmt: skip
    return [d for d, ok in reached if ok]


def book_rows(facts: Facts, chapters: Sequence[ChapterRow], clock: Clock) -> list[BookRow]:
    minutes: dict[uuid.UUID, list[MinuteFact]] = defaultdict(list)
    for m in facts.minutes:
        if m.document_id is not None:
            minutes[m.document_id].append(m)
    rows: list[BookRow] = []
    for book in facts.books:
        own = minutes.get(book.id, [])
        seconds: dict[Surface, int] = defaultdict(int)
        for m in own:
            seconds[m.surface] += m.seconds
        notes = [n for n in facts.notes if n.document_id == book.id]
        recalls = [r for r in facts.recalls if r.document_id == book.id]
        reviews = [r for r in facts.reviews if r.document_id == book.id]
        positions = [p for p in facts.positions if p.document_id == book.id]
        stamps = [m.minute for m in own] + [n.created_at for n in notes]
        stamps += [r.created_at for r in recalls] + [r.reviewed_at for r in reviews]
        stamps += [p.updated_at for p in positions]
        progress, finished, total = book_progress(book, facts.positions)
        highlights = sum(1 for n in notes if n.highlight)
        last = max(stamps, default=None)
        words_read = book.words * progress
        rows.append(
            BookRow(
                id=str(book.id),
                slug=book.slug,
                title=book.title,
                authors=list(book.authors),
                pages=book.pages,
                words=book.words,
                chapters=total,
                chapters_finished=finished,
                progress=round(progress, 4),
                state=_state(progress, finished, total, last, clock.now),
                seconds=dict(seconds),
                total_seconds=sum(seconds.values()),
                words_per_minute=reading_speed([c for c in chapters if c.document == book.slug]),
                notes=len(notes) - highlights,
                highlights=highlights,
                notes_per_1k_words=rounded(ratio(len(notes), words_read / 1000), 2),
                recalls=sum(1 for r in recalls if r.kind == "recall"),
                reviews=len(reviews),
                retention=rounded(ratio(sum(1 for r in reviews if r.rating > 1), len(reviews)), 3),
                depth=_depth(progress, bool(stamps), len(notes), len(recalls), len(reviews)),
                first_seen=min(stamps, default=None),
                last_seen=last,
            )
        )
    return rows

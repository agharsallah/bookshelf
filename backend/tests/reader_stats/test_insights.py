"""Insight rules fire on the figures they describe, and stay quiet otherwise."""

from dataclasses import replace
from datetime import timedelta

from app.models.enums import Surface
from app.reader_stats import attention
from app.reader_stats.insights import Context, insights
from app.reader_stats.insights.habit import peak_hours, streak, tracking_started
from app.reader_stats.insights.learning import due_backlog, missed_ideas, unrecalled
from app.reader_stats.insights.progress import slow_chapters, stalled
from app.schemas.reader_stats import (
    BookRow,
    BookState,
    ChapterRow,
    Count,
    HourCell,
    MemoryStats,
    NoteStats,
    Tone,
    Totals,
)
from tests.reader_stats.builders import T0, clock, minutes


def context(**overrides: object) -> Context:
    base = Context(
        clock=clock(), totals=Totals(), surfaces=[], hours=[], sittings=[], books=[],
        chapters=[], passages=[], notes=NoteStats(), memory=MemoryStats(), tracked_since=T0,
    )  # fmt: skip
    return replace(base, **overrides)


def book_row(**overrides: object) -> BookRow:
    fields: dict[str, object] = {
        "id": "1", "slug": "book", "title": "The Book", "authors": [], "pages": 100,
        "words": 10_000, "chapters": 5, "chapters_finished": 2, "progress": 0.4,
        "state": BookState.READING,
    }  # fmt: skip
    return BookRow.model_validate(fields | overrides)


def test_evening_readers_hear_about_their_peak_hours():
    hours = [HourCell(weekday=d, hour=h, seconds=1800) for d in range(4) for h in (20, 21)]
    ctx = context(totals=Totals(seconds=4 * 3600), hours=hours)

    [found] = peak_hours(ctx)

    assert "between" in found.title
    assert found.value == 1.0


def test_habits_wait_for_enough_tracked_time():
    ctx = context(totals=Totals(seconds=600), hours=[HourCell(weekday=0, hour=9, seconds=600)])

    assert list(peak_hours(ctx)) == []


def test_a_streak_is_praised_and_an_ended_one_noted():
    [praise] = streak(context(totals=Totals(current_streak=4, longest_streak=4)))
    [ended] = streak(context(totals=Totals(current_streak=0, longest_streak=6)))

    assert (praise.tone, ended.tone) == (Tone.POSITIVE, Tone.ATTENTION)


def test_stalled_books_say_how_long_they_waited():
    row = book_row(state=BookState.STALLED, last_seen=T0 - timedelta(days=30))

    [found] = stalled(context(books=[row]))

    assert found.title == "The Book has waited 30 days at 40%"
    assert found.href == "/documents/book"


def test_slow_chapters_link_to_the_chapter():
    fields: dict[str, object] = {
        "document": "book", "book_title": "The Book", "anchor": "ch03", "title": "Delays",
        "position": 2, "words": 4000, "pages": 12, "progress": 1.0,
    }  # fmt: skip
    slow = ChapterRow.model_validate(fields | {"pace": 2.0})
    usual = ChapterRow.model_validate(fields | {"anchor": "ch01", "pace": 1.0})
    rows = [slow, usual]

    [found] = slow_chapters(context(chapters=rows))

    assert found.href == "/documents/book/read/ch03"


def test_memory_rules_need_their_figures():
    quiet = context(totals=Totals(chapters_finished=1))
    loud = context(
        totals=Totals(chapters_finished=5),
        memory=MemoryStats(
            due_now=12, ideas=[Count(key="recalled", count=2), Count(key="missed", count=3)]
        ),
    )

    assert [list(r(quiet)) for r in (unrecalled, due_backlog, missed_ideas)] == [[], [], []]
    assert all(list(r(loud)) for r in (unrecalled, due_backlog, missed_ideas))


def test_no_tracked_time_yet_says_so():
    [found] = tracking_started(context(tracked_since=None))

    assert found.metric == "tracked_days"


def test_insights_put_what_needs_attention_first():
    ctx = context(
        totals=Totals(current_streak=5, longest_streak=5, chapters_finished=4),
        sittings=attention.sittings(minutes(5, surface=Surface.READ)),
    )

    tones = [i.tone for i in insights(ctx)]

    assert tones == sorted(tones, key=[Tone.ATTENTION, Tone.POSITIVE, Tone.NEUTRAL].index)
    assert tones[0] is Tone.ATTENTION

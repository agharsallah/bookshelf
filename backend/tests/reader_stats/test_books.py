"""Per-chapter pace and per-book progress, state and depth."""

from datetime import timedelta

from app.models.enums import Surface
from app.reader_stats import books
from app.reader_stats.facts import Facts
from app.schemas.reader_stats import BookState, Depth
from tests.reader_stats.builders import (
    T0,
    at,
    book,
    chapter,
    clock,
    minutes,
    note,
    position,
    recall,
)


def two_chapters() -> Facts:
    return Facts(
        books=(book(chapter("ch01", words=3000), chapter("ch02", words=3000, position=1)),),
        minutes=tuple(minutes(10) + minutes(20, start=30, unit="ch02", anchor="ch02/p001")),
        positions=(position("ch01", 1.0), position("ch02", 1.0)),
    )


def test_pace_compares_each_chapter_with_your_usual_speed():
    rows = books.chapter_rows(two_chapters(), clock())

    assert [(r.anchor, r.words_per_minute) for r in rows] == [("ch01", 300.0), ("ch02", 150.0)]
    assert rows[1].pace is not None and rows[1].pace > 1 > (rows[0].pace or 0)


def test_reading_speed_ignores_chapters_opened_for_a_moment():
    facts = Facts(
        books=(book(chapter("ch01"), chapter("ch02", position=1)),),
        minutes=tuple(minutes(10) + minutes(1, start=30, unit="ch02", anchor="ch02/p001")),
        positions=(position("ch01", 1.0), position("ch02", 0.5)),
    )

    rows = books.chapter_rows(facts, clock())

    assert rows[1].words_per_minute is None
    assert books.reading_speed(rows) == 300.0


def test_notes_and_time_land_on_the_chapter_they_are_under():
    facts = Facts(
        books=(book(),),
        minutes=tuple(minutes(2, unit="", anchor="ch01/p001", surface=Surface.LISTEN)),
        notes=(note(), note(words=0)),
    )

    [row] = books.chapter_rows(facts, clock())

    assert (row.listen_seconds, row.notes, row.highlights, row.visits) == (120, 1, 1, 1)


def test_a_book_all_of_whose_chapters_are_finished_is_finished():
    facts = two_chapters()
    [row] = books.book_rows(facts, books.chapter_rows(facts, clock()), clock())

    assert (row.state, row.progress, row.chapters_finished) == (BookState.FINISHED, 1.0, 2)


def test_a_started_book_untouched_for_three_weeks_has_stalled():
    facts = Facts(books=(book(),), positions=(position(progress=0.3),))
    later = clock(now=T0 + timedelta(days=30))

    [row] = books.book_rows(facts, books.chapter_rows(facts, later), later)

    assert row.state is BookState.STALLED


def test_a_book_never_opened_is_unread():
    facts = Facts(books=(book(),))

    [row] = books.book_rows(facts, [], clock())

    assert (row.state, row.depth) == (BookState.UNREAD, [])


def test_depth_records_every_level_reached():
    facts = Facts(
        books=(book(),),
        minutes=tuple(minutes(3)),
        positions=(position(progress=0.5),),
        notes=(note(created_at=at(1)),),
        recalls=(recall(),),
    )

    [row] = books.book_rows(facts, books.chapter_rows(facts, clock()), clock())

    assert row.depth == [Depth.OPENED, Depth.READ, Depth.ANNOTATED, Depth.RECALLED]

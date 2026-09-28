"""Time per surface, day and hour; sittings split on gaps; streaks that may end yesterday."""

from datetime import date, timedelta

from app.models.enums import Surface
from app.reader_stats import attention
from app.reader_stats.facts import Facts
from tests.reader_stats.builders import T0, at, book, clock, minute, minutes, note, position


def test_a_gap_longer_than_ten_minutes_starts_a_new_sitting():
    found = attention.sittings(minutes(3) + minutes(2, start=13) + minutes(1, start=40))

    assert [s.seconds for s in found] == [180, 120, 60]
    assert found[0].end == at(3)


def test_two_places_in_one_minute_count_that_minute_once_at_most():
    both = [minute(0, seconds=40), minute(0, anchor="ch01/p002", seconds=40)]

    [sitting] = attention.sittings(both)

    assert sitting.seconds == 60
    assert sitting.surfaces == {Surface.READ: 80}


def test_a_sitting_spans_surfaces():
    [sitting] = attention.sittings(minutes(2) + minutes(2, start=3, surface=Surface.LISTEN))

    assert sitting.surfaces == {Surface.READ: 120, Surface.LISTEN: 120}


def test_hours_are_local_to_the_time_zone():
    [cell] = attention.hours([minute(0)], clock(tz="Asia/Tokyo"))

    assert (cell.weekday, cell.hour) == (1, 18)  # 09:00 UTC Tuesday is 18:00 in Tokyo


def test_days_count_time_and_actions_on_the_local_day():
    facts = Facts(books=(book(),), minutes=tuple(minutes(2)), notes=(note(created_at=at(days=1)),))

    points = attention.daily(facts, clock())

    assert [(p.date, p.seconds, p.notes) for p in points] == [
        (date(2026, 9, 1), {Surface.READ: 120}, 0),
        (date(2026, 9, 2), {}, 1),
    ]


def test_the_current_streak_may_end_yesterday():
    today = T0.date()
    days = {today - timedelta(days=d) for d in (1, 2, 3, 6, 7)}

    assert attention.streaks(days, today) == (3, 3)


def test_a_day_off_ends_the_current_streak():
    today = T0.date()

    assert attention.streaks({today - timedelta(days=2)}, today) == (0, 1)


def test_surfaces_come_most_time_first_with_their_share():
    shares = attention.surfaces(minutes(1) + minutes(3, start=5, surface=Surface.LISTEN))

    assert [(s.surface, s.share) for s in shares] == [(Surface.LISTEN, 0.75), (Surface.READ, 0.25)]


def test_a_moved_reading_place_counts_as_an_active_day_inside_the_window():
    facts = Facts(
        books=(book(),), positions=(position(updated_at=at(days=-10)), position(unit="ch02"))
    )

    assert attention.active_days(facts, clock(), since=T0.date() - timedelta(days=3)) == {T0.date()}
    assert [p.moves for p in attention.daily(facts, clock())] == [1, 1]

"""Rules about when and how you read: peak hours, weekdays, streaks, sittings, listening."""

from collections import defaultdict
from collections.abc import Iterable

from app.models.enums import Surface
from app.reader_stats.insights.context import Context, hours_label, pct
from app.reader_stats.numbers import median
from app.schemas.reader_stats import InsightTopic, ReaderInsight, Tone

WEEKDAYS = ("Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays")


def _habit(tone: Tone, title: str, detail: str, metric: str, value: float) -> ReaderInsight:
    return ReaderInsight(
        tone=tone, topic=InsightTopic.HABIT, title=title, detail=detail, metric=metric,
        value=round(value, 3),
    )  # fmt: skip


def peak_hours(ctx: Context) -> Iterable[ReaderInsight]:
    t, total = ctx.limits, ctx.totals.seconds
    if total < t.min_tracked_seconds:
        return
    by_hour: dict[int, int] = defaultdict(int)
    for cell in ctx.hours:
        by_hour[cell.hour] += cell.seconds
    width = t.peak_window_hours
    start = max(range(24), key=lambda h: sum(by_hour[(h + i) % 24] for i in range(width)))
    share = sum(by_hour[(start + i) % 24] for i in range(width)) / total
    if share >= t.peak_share:
        yield _habit(
            Tone.NEUTRAL,
            f"You read most between {start:02d}:00 and {(start + width) % 24:02d}:00",
            f"{pct(share)} of your tracked time falls in those {width} hours. Guard them: "
            "that is when a chapter gets finished.",
            "peak_window_share", share,
        )  # fmt: skip


def best_weekday(ctx: Context) -> Iterable[ReaderInsight]:
    t, total = ctx.limits, ctx.totals.seconds
    if total < t.min_tracked_seconds:
        return
    by_day: dict[int, int] = defaultdict(int)
    for cell in ctx.hours:
        by_day[cell.weekday] += cell.seconds
    day, seconds = max(by_day.items(), key=lambda kv: kv[1])
    share = seconds / total
    if share >= t.weekday_share:
        yield _habit(
            Tone.NEUTRAL, f"{WEEKDAYS[day]} are your reading day",
            f"{pct(share)} of your time ({hours_label(seconds)}) is on {WEEKDAYS[day]}.",
            "weekday_share", share,
        )  # fmt: skip


def streak(ctx: Context) -> Iterable[ReaderInsight]:
    current, longest = ctx.totals.current_streak, ctx.totals.longest_streak
    if current >= ctx.limits.streak_praise:
        detail = "Your longest run yet." if current >= longest else f"Your best is {longest}."
        yield _habit(Tone.POSITIVE, f"{current} days in a row", detail, "current_streak", current)
    elif current == 0 and longest >= ctx.limits.streak_praise:
        yield _habit(
            Tone.ATTENTION, f"Your {longest}-day streak has ended",
            "Nothing yesterday or today. Ten minutes with the book you are reading "
            "starts a new one.",
            "current_streak", 0,
        )  # fmt: skip


def short_sittings(ctx: Context) -> Iterable[ReaderInsight]:
    t = ctx.limits
    lengths = [s.seconds for s in ctx.sittings]
    typical = median(lengths)
    if len(lengths) >= t.min_sessions and typical is not None and typical < t.short_session_seconds:
        yield _habit(
            Tone.NEUTRAL, f"A typical sitting lasts {hours_label(typical)}",
            "Short sittings suit review and listening; a hard chapter usually needs 25 "
            "minutes or more at a stretch.",
            "median_session_seconds", typical,
        )  # fmt: skip


def listening(ctx: Context) -> Iterable[ReaderInsight]:
    listened = next((s for s in ctx.surfaces if s.surface is Surface.LISTEN), None)
    if (
        listened
        and ctx.totals.seconds >= ctx.limits.min_tracked_seconds
        and (listened.share >= ctx.limits.listening_share)
    ):
        yield _habit(
            Tone.NEUTRAL, f"{pct(listened.share)} of your time is listening",
            "Listening covers ground; a recall after a listened chapter shows what stayed.",
            "listening_share", listened.share,
        )  # fmt: skip


def tracking_started(ctx: Context) -> Iterable[ReaderInsight]:
    since = ctx.tracked_since
    if since is None:
        yield _habit(
            Tone.NEUTRAL, "Time tracking starts with your next page",
            "Reading, listening and study time are counted from now on; progress, notes, "
            "recalls and reviews already cover your whole history.",
            "tracked_days", 0,
        )  # fmt: skip
        return
    days = ctx.clock.days_ago(since)
    if days < ctx.limits.new_tracking_days:
        yield _habit(
            Tone.NEUTRAL, f"Time has been tracked for {days + 1} {'day' if days == 0 else 'days'}",
            "Habits (hours, weekdays, sittings) settle after a couple of weeks.",
            "tracked_days", days + 1,
        )  # fmt: skip

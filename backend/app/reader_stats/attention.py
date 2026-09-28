"""Where the time went: per surface, per day, per weekday and hour, and in sessions.

A session is a run of tracked minutes with no gap longer than `SESSION_GAP` between them,
whatever the surface: reading, then listening on the way to the kitchen, is one sitting.
"""

import uuid
from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from app.models.enums import Surface
from app.reader_stats.clock import Clock
from app.reader_stats.facts import Facts, MinuteFact
from app.reader_stats.numbers import bins, share
from app.schemas.reader_stats import DayPoint, HistogramBin, HourCell, Session, SurfaceTime

SESSION_GAP = timedelta(minutes=10)
MINUTE = 60
SESSION_BINS = (
    ("< 5 min", 0), ("5-15 min", 5 * MINUTE), ("15-30 min", 15 * MINUTE),
    ("30-60 min", 30 * MINUTE), ("1-2 h", 60 * MINUTE), ("2 h +", 120 * MINUTE),
)  # fmt: skip


def by_surface(minutes: Iterable[MinuteFact]) -> dict[Surface, int]:
    out: dict[Surface, int] = defaultdict(int)
    for m in minutes:
        out[m.surface] += m.seconds
    return dict(out)


def surfaces(minutes: Sequence[MinuteFact]) -> list[SurfaceTime]:
    """Every surface with time, most first."""
    totals = by_surface(minutes)
    whole = sum(totals.values())
    return [
        SurfaceTime(surface=s, seconds=v, share=round(share(v, whole), 4))
        for s, v in sorted(totals.items(), key=lambda kv: -kv[1])
    ]


def daily(facts: Facts, clock: Clock, since: date = date.min) -> list[DayPoint]:
    """One point per day from `since` with tracked time or an action, oldest first."""
    seconds: dict[date, dict[Surface, int]] = defaultdict(lambda: defaultdict(int))
    for m in facts.minutes:
        seconds[clock.day(m.minute)][m.surface] += m.seconds
    counts: dict[str, dict[date, int]] = {"notes": {}, "reviews": {}, "recalls": {}, "moves": {}}
    stamps = {
        "notes": (n.created_at for n in facts.notes),
        "reviews": (r.reviewed_at for r in facts.reviews),
        "recalls": (r.created_at for r in facts.recalls),
        "moves": (p.updated_at for p in facts.positions),
    }
    for name, ats in stamps.items():
        for at in ats:
            day = clock.day(at)
            if day >= since:
                counts[name][day] = counts[name].get(day, 0) + 1
    days = set(seconds) | {d for c in counts.values() for d in c}
    return [
        DayPoint(
            date=d,
            seconds=dict(seconds.get(d, {})),
            notes=counts["notes"].get(d, 0),
            reviews=counts["reviews"].get(d, 0),
            recalls=counts["recalls"].get(d, 0),
            moves=counts["moves"].get(d, 0),
        )
        for d in sorted(days)
    ]


def hours(minutes: Iterable[MinuteFact], clock: Clock) -> list[HourCell]:
    """Tracked seconds by local weekday and hour; only cells with time."""
    grid: dict[tuple[int, int], int] = defaultdict(int)
    for m in minutes:
        local = clock.local(m.minute)
        grid[(local.weekday(), local.hour)] += m.seconds
    return [HourCell(weekday=w, hour=h, seconds=s) for (w, h), s in sorted(grid.items())]


@dataclass(frozen=True, slots=True)
class Sitting:
    start: datetime
    end: datetime  # the end of its last minute
    seconds: int
    surfaces: dict[Surface, int]
    documents: dict[uuid.UUID, int]


def sittings(minutes: Sequence[MinuteFact]) -> list[Sitting]:
    """Sessions, oldest first."""
    ordered = sorted(minutes, key=lambda m: m.minute)
    out: list[Sitting] = []
    group: list[MinuteFact] = []

    def close() -> None:
        if not group:
            return
        per_minute: dict[datetime, int] = defaultdict(int)
        docs: dict[uuid.UUID, int] = defaultdict(int)
        for m in group:
            per_minute[m.minute] += m.seconds
            if m.document_id is not None:
                docs[m.document_id] += m.seconds
        out.append(
            Sitting(
                start=group[0].minute,
                end=group[-1].minute + timedelta(minutes=1),
                seconds=sum(min(MINUTE, s) for s in per_minute.values()),
                surfaces=by_surface(group),
                documents=dict(docs),
            )
        )

    for m in ordered:
        if group and m.minute - group[-1].minute > SESSION_GAP:
            close()
            group = []
        group.append(m)
    close()
    return out


def session_lengths(found: Sequence[Sitting]) -> list[HistogramBin]:
    return bins((s.seconds for s in found), SESSION_BINS)


def recent_sessions(
    found: Sequence[Sitting], slugs: Mapping[uuid.UUID, str], limit: int = 40
) -> list[Session]:
    return [
        Session(
            start=s.start,
            end=s.end,
            seconds=s.seconds,
            surfaces=s.surfaces,
            documents=[
                slugs[d]
                for d, _ in sorted(s.documents.items(), key=lambda kv: -kv[1])
                if d in slugs
            ],
        )
        for s in reversed(found[-limit:])
    ]


def active_days(facts: Facts, clock: Clock, since: date = date.min) -> set[date]:
    """Days from `since` with tracked time or any action: a note, a recall, a review, a
    moved place (progress is loaded whatever the window, so its dates are filtered here)."""
    stamps: list[datetime] = [m.minute for m in facts.minutes]
    stamps += [n.created_at for n in facts.notes]
    stamps += [r.created_at for r in facts.recalls]
    stamps += [r.reviewed_at for r in facts.reviews]
    stamps += [p.updated_at for p in facts.positions]
    return {day for at in stamps if (day := clock.day(at)) >= since}


def streaks(days: set[date], today: date) -> tuple[int, int]:
    """(current, longest) runs of consecutive active days. The current run may end
    yesterday: today is not over yet."""
    longest = run = 0
    previous: date | None = None
    for day in sorted(days):
        run = run + 1 if previous is not None and day - previous == timedelta(days=1) else 1
        longest = max(longest, run)
        previous = day
    current = 0
    cursor = today if today in days else today - timedelta(days=1)
    while cursor in days:
        current += 1
        cursor -= timedelta(days=1)
    return current, longest

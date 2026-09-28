"""Remembering it: graded recalls, predictions, spaced reviews and the cards still ahead."""

import uuid
from collections import Counter
from collections.abc import Mapping
from datetime import date, timedelta

from app.reader_stats.clock import Clock
from app.reader_stats.facts import BookFact, Facts
from app.reader_stats.notes import counts
from app.reader_stats.numbers import mean, ratio, rounded
from app.schemas.reader_stats import Count, DuePoint, MemoryStats, RecallPoint

RATINGS = {1: "again", 2: "hard", 3: "good", 4: "easy"}
CARD_STATES = {1: "learning", 2: "review", 3: "relearning"}
IDEA_STATUSES = ("recalled", "partial", "missed")
FORECAST_DAYS = 14


def _chapter_titles(books: Mapping[uuid.UUID, BookFact]) -> dict[tuple[uuid.UUID, str], str]:
    return {(b.id, c.anchor): c.title for b in books.values() for c in b.chapters}


def _trend(facts: Facts) -> list[RecallPoint]:
    books = {b.id: b for b in facts.books}
    titles = _chapter_titles(books)
    points = []
    for r in sorted(facts.recalls, key=lambda r: r.created_at):
        score = r.score
        if r.kind != "recall" or score is None or r.document_id not in books:
            continue
        seen = Counter(r.statuses or ())
        points.append(
            RecallPoint(
                at=r.created_at,
                document=books[r.document_id].slug,
                unit=r.unit,
                chapter=titles.get((r.document_id, r.unit), r.unit),
                score=round(score, 3),
                recalled=seen["recalled"],
                partial=seen["partial"],
                missed=seen["missed"],
            )
        )
    return points


def _due(facts: Facts, clock: Clock) -> tuple[int, list[DuePoint]]:
    today = clock.today
    due_now = sum(1 for c in facts.cards if clock.day(c.due) <= today)
    ahead: Counter[date] = Counter(
        clock.day(c.due) for c in facts.cards
        if today < clock.day(c.due) <= today + timedelta(days=FORECAST_DAYS)
    )  # fmt: skip
    return due_now, [
        DuePoint(date=today + timedelta(days=i), count=ahead.get(today + timedelta(days=i), 0))
        for i in range(1, FORECAST_DAYS + 1)
    ]


def memory_stats(facts: Facts, clock: Clock) -> MemoryStats:
    graded = [r for r in facts.recalls if r.kind == "recall" and r.statuses]
    ideas = Counter(s for r in graded for s in r.statuses or ())
    ratings = Counter(r.rating for r in facts.reviews)
    due_now, due = _due(facts, clock)
    stabilities = [c.stability for c in facts.cards if c.stability is not None]
    return MemoryStats(
        recalls=sum(1 for r in facts.recalls if r.kind == "recall"),
        predictions=sum(1 for r in facts.recalls if r.kind == "prediction"),
        graded=len(graded),
        ideas=[Count(key=s, count=ideas[s]) for s in IDEA_STATUSES if graded],
        trend=_trend(facts),
        reviews=len(facts.reviews),
        ratings=[Count(key=name, count=ratings[k]) for k, name in RATINGS.items()]
        if facts.reviews else [],
        retention=rounded(ratio(len(facts.reviews) - ratings[1], len(facts.reviews)), 3),
        cards=len(facts.cards),
        card_states=counts([CARD_STATES.get(c.state or 0, "new") for c in facts.cards]),
        due_now=due_now,
        due=due if facts.cards else [],
        mean_stability_days=rounded(mean(stabilities), 1),
        by_source=counts([r.source for r in facts.reviews]),
    )  # fmt: skip

"""Recall grades, retention, cards due; the passages you spent longest on and annotated."""

from datetime import timedelta

from app.reader_stats import memory, passages
from app.reader_stats.facts import Facts
from tests.reader_stats.builders import (
    BOOK,
    T0,
    at,
    book,
    card,
    clock,
    minutes,
    note,
    recall,
    review,
)


def test_recall_score_counts_partial_ideas_as_half():
    assert recall(("recalled", "partial", "missed", "missed")).score == 0.375
    assert recall(None).score is None


def test_memory_counts_ideas_ratings_retention_and_what_is_due():
    facts = Facts(
        books=(book(),),
        recalls=(recall(("recalled", "partial")), recall(None, kind="prediction")),
        reviews=(review(1), review(3), review(4), review(3)),
        cards=(card(T0), card(T0 + timedelta(days=2)), card(T0 + timedelta(days=30))),
    )

    stats = memory.memory_stats(facts, clock())

    assert (stats.recalls, stats.predictions, stats.graded) == (1, 1, 1)
    assert {c.key: c.count for c in stats.ideas} == {"recalled": 1, "partial": 1, "missed": 0}
    assert [c.count for c in stats.ratings] == [1, 0, 2, 1]
    assert stats.retention == 0.75
    assert stats.due_now == 1
    assert [p.count for p in stats.due][:2] == [0, 1]
    assert sum(p.count for p in stats.due) == 1  # the one a month out is past the forecast


def fake_texts(blocks):
    return {b: f"text of {b[1]}" for b in blocks}


def test_the_most_visited_passage_is_the_one_with_the_most_time():
    facts = Facts(
        books=(book(),),
        minutes=tuple(minutes(2) + minutes(5, start=20, anchor="ch01/p002")),
        notes=(note("ch01/p001"),),
    )

    rows = passages.visited(facts, clock(), fake_texts)

    assert [(r.anchor, r.seconds, r.notes) for r in rows] == [
        ("ch01/p002", 300, 0),
        ("ch01/p001", 120, 1),
    ]
    assert rows[0].text == "text of ch01/p002"
    assert rows[0].chapter == "Chapter ch01"


def test_visits_are_distinct_days():
    facts = Facts(books=(book(),), minutes=tuple(minutes(2) + minutes(1, start=24 * 60)))

    [row] = passages.visited(facts, clock(), fake_texts)

    assert row.visits == 2


def test_annotated_passages_rank_by_notes():
    facts = Facts(
        books=(book(),),
        notes=(note("ch01/p001"), note("ch01/p002"), note("ch01/p002", created_at=at(5))),
    )

    rows = passages.annotated(facts, clock(), fake_texts)

    assert [(r.anchor, r.notes) for r in rows] == [("ch01/p002", 2), ("ch01/p001", 1)]
    assert BOOK  # every row belongs to the one book

"""Ranking feed candidates (`app.pills.feed.rank`): pure, seeded, deterministic."""

import uuid
from typing import Any

import pytest

from app.models.enums import PillKind
from app.pills.feed.rank import (
    Candidate,
    KindSignals,
    affinity,
    rank,
    score,
)

DOC = uuid.UUID(int=1)


def cand(n: int, **fields: Any) -> Candidate:
    base: dict[str, Any] = {
        "id": uuid.UUID(int=n),
        "kind": PillKind.INSIGHT,
        "document_id": DOC,
        "anchor": "ch01",
        "active": False,
    }
    return Candidate(**(base | fields))


def test_a_fresh_pill_scores_its_scope_match():
    assert score(cand(1)) == 1.0
    assert score(cand(1, scope_match=1.5)) == 1.5


def test_a_seen_pill_drops_to_novelty():
    assert score(cand(1, seen=3)) == pytest.approx(0.15)


def test_drafts_spacing_and_affinity_scale_the_score():
    assert score(cand(1, draft=True)) == pytest.approx(0.8)
    assert score(cand(1, unit_recent=5)) == pytest.approx(0.5)
    assert score(cand(1), kind_affinity=0.5) == pytest.approx(1.5)
    assert score(cand(1), kind_affinity=-0.5) == pytest.approx(0.5)


def test_two_confusing_marks_sink_a_pill_one_does_not():
    assert score(cand(1, confusing=1)) == 1.0
    assert score(cand(1, confusing=2)) == pytest.approx(0.05)


def test_affinity_is_zero_without_history_and_clamped():
    assert affinity(KindSignals()) == 0.0
    assert affinity(KindSignals(seen=4, saves=40)) == 0.5
    assert affinity(KindSignals(seen=4, skips=40)) == -0.5


def test_affinity_weighs_signals_against_views():
    liked = KindSignals(seen=10, saves=2, long_dwells=2)
    disliked = KindSignals(seen=10, skips=2, too_easy=2, confusing=1)
    assert affinity(liked) == pytest.approx(0.3)
    assert affinity(disliked) == pytest.approx(-0.3)


def test_few_views_are_damped():
    assert affinity(KindSignals(seen=1, saves=1)) == pytest.approx(0.25)


def test_rank_orders_by_score_and_replays_with_the_same_seed():
    pool = [cand(1, seen=1), cand(2, scope_match=1.5), cand(3), cand(4, confusing=2)]
    first = [r.candidate.id.int for r in rank(pool, seed=7)]
    again = [r.candidate.id.int for r in rank(list(reversed(pool)), seed=7)]
    assert first == again
    assert first[0] == 2
    assert first[-2:] == [1, 4]


def test_the_seed_breaks_ties_differently():
    pool = [cand(n) for n in range(1, 30)]
    orders = {tuple(r.candidate.id.int for r in rank(pool, seed=s)) for s in range(5)}
    assert len(orders) > 1


def test_kind_affinity_lifts_a_kind_you_like():
    pool = [cand(1, kind=PillKind.QUOTE), cand(2, kind=PillKind.INSIGHT)]
    signals = {PillKind.QUOTE: KindSignals(seen=10, saves=5)}
    assert rank(pool, seed=1, signals=signals)[0].candidate.kind is PillKind.QUOTE
    signals = {PillKind.QUOTE: KindSignals(seen=10, skips=8)}
    assert rank(pool, seed=1, signals=signals)[0].candidate.kind is PillKind.INSIGHT

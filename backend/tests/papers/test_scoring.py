"""Candidate scoring: explainable (every part named, parts sum to the score), monotone in
every input, and deterministically ranked."""

import dataclasses
from uuid import UUID

import pytest

from app.papers.scoring import PARTS, CandidateFacts, Source, Weights, rank, score

A = UUID(int=1)
B = UUID(int=2)
YEAR = 2026
RATINGS = {A: 5, B: 2}


def facts(**overrides) -> CandidateFacts:
    base = CandidateFacts(
        key="W1",
        sources=(Source("reference", A),),
        shelf_citers=1,
        intents=("uses",),
        cited_by_count=100,
        year=2020,
        similarity=0.5,
    )
    return dataclasses.replace(base, **overrides)


def total(candidate: CandidateFacts, ratings=RATINGS, weights: Weights | None = None) -> float:
    kwargs = {"weights": weights} if weights else {}
    return score(candidate, ratings=ratings, current_year=YEAR, **kwargs).score


def test_every_part_is_named_and_the_parts_sum_to_the_score():
    scored = score(facts(), ratings=RATINGS, current_year=YEAR)
    assert tuple(scored.parts) == PARTS
    assert all(value > 0 for value in scored.parts.values())
    assert scored.score == pytest.approx(sum(scored.parts.values()), abs=1e-6)


def test_absent_signals_score_zero_but_stay_in_the_breakdown():
    bare = CandidateFacts(key="W1", sources=(Source("related"),))
    parts = score(bare, ratings={}, current_year=YEAR).parts
    assert parts == {**dict.fromkeys(PARTS, 0.0), "source": 0.5}


@pytest.mark.parametrize(
    ("worse", "better"),
    [
        ({"shelf_citers": 1}, {"shelf_citers": 3}),
        ({"cited_by_count": 10}, {"cited_by_count": 10_000}),
        ({"year": 2010}, {"year": 2025}),
        ({"similarity": 0.2}, {"similarity": 0.9}),
        ({"intents": ("background",)}, {"intents": ("extends",)}),
        ({"intents": ("uses",)}, {"intents": ("uses", "compares")}),
        ({"sources": (Source("related", A),)}, {"sources": (Source("reference", A),)}),
        ({"sources": (Source("reference", B),)}, {"sources": (Source("reference", A),)}),
        (
            {"sources": (Source("reference", A),)},
            {"sources": (Source("reference", A), Source("cited_by", B))},
        ),
    ],
)
def test_more_or_stronger_evidence_never_lowers_the_score(worse, better):
    assert total(facts(**better)) > total(facts(**worse))


def test_a_disliked_source_paper_pulls_the_rating_term_below_zero():
    parts = score(
        facts(sources=(Source("reference", B),)), ratings=RATINGS, current_year=YEAR
    ).parts
    assert parts["rating"] == pytest.approx(1.5 * (2 - 3) / 2)


def test_weights_are_tunable_and_zero_switches_a_term_off():
    no_citations = Weights(citations=0.0)
    parts = score(facts(), ratings=RATINGS, current_year=YEAR, weights=no_citations).parts
    assert parts["citations"] == 0.0
    with pytest.raises(ValueError):
        Weights(shelf=-1)


def test_unknown_kinds_and_intents_are_refused_rather_than_silently_scored():
    with pytest.raises(ValueError):
        total(facts(sources=(Source("rumour", A),)))
    with pytest.raises(ValueError):
        total(facts(intents=("likes",)))


def test_enum_members_score_like_their_values():
    from app.models.enums import CandidateSource, CitationIntent

    as_enums = facts(
        sources=(Source(CandidateSource.REFERENCE, A),), intents=(CitationIntent.USES,)
    )
    assert total(as_enums) == total(facts())


def test_rank_orders_best_first_and_breaks_ties_by_citers_citations_then_key():
    strong = facts(key="W9", shelf_citers=4)
    tie_b, tie_a = facts(key="W3"), facts(key="W2")
    weak = facts(key="W1", sources=(Source("related"),), shelf_citers=0, intents=())
    ranked = rank([weak, tie_b, strong, tie_a], ratings=RATINGS, current_year=YEAR)
    assert [s.key for s in ranked] == ["W9", "W2", "W3", "W1"]
    again = rank([tie_a, weak, strong, tie_b], ratings=RATINGS, current_year=YEAR)
    assert [s.key for s in again] == [s.key for s in ranked]

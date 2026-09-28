"""Deterministic scoring of reading candidates (docs/PAPERS.md §5, P6).

Pure: facts in, a score and its named parts out. The model never ranks; `recommend-next`
only explains the top N, and the UI explains any candidate from `score_parts`.

    score = source + rating + shelf + intent + citations + recency + similarity

    source     = Σ_{distinct kinds k in sources} w_kind[k]
                 (reference 1.0 · watch 0.9 · cited_by 0.8 · similar 0.6 · related 0.5)
    rating     = w_rating · (max stars among rated source papers - 3) / 2      ∈ [-w, +w]
                 (0 when no source paper is rated)
    shelf      = w_shelf · log2(1 + shelf papers citing it)
    intent     = w_intent · ln(1 + Σ_{intents} w_intent_kind[i])
                 (extends 1.0 · uses 0.8 · contradicts 0.6 · compares 0.5 · background 0.1)
    citations  = w_citations · log10(1 + cited_by_count)
    recency    = w_recency · 0.5 ^ (max(0, current_year - year) / half_life)   (0 without year)
    similarity = w_similarity · max(0, cosine to your ≥ 4-star papers)       (0 when unknown)

Every term is a non-decreasing function of its input, so more evidence never lowers a
score: another source, a better-rated source, another shelf citer, a stronger intent, more
citations, a newer year, a closer embedding. Parts are rounded to 6 decimals and the score
is their sum, so equal facts give equal scores on every run. `rank` breaks ties by shelf
citers, then citation count, then `key` (ascending), so order is total and stable.
"""

import math
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from types import MappingProxyType
from uuid import UUID

# Source kinds and intents are plain strings keyed into `Weights`, so `CandidateSource` and
# `CitationIntent` members (StrEnums, `models/enums.py`) pass as they are; unknown ones raise.
PARTS = ("source", "rating", "shelf", "intent", "citations", "recency", "similarity")
_DIGITS = 6


def _frozen(values: dict[str, float]) -> Mapping[str, float]:
    return MappingProxyType(values)


@dataclass(frozen=True, slots=True)
class Weights:
    """Tunable weights; the defaults put one strong signal at roughly 1.0."""

    kinds: Mapping[str, float] = field(
        default_factory=lambda: _frozen(
            {"reference": 1.0, "watch": 0.9, "cited_by": 0.8, "similar": 0.6, "related": 0.5}
        )
    )
    intents: Mapping[str, float] = field(
        default_factory=lambda: _frozen(
            {"extends": 1.0, "uses": 0.8, "contradicts": 0.6, "compares": 0.5, "background": 0.1}
        )
    )
    rating: float = 1.5
    shelf: float = 1.0
    intent: float = 1.0
    citations: float = 0.25  # 10 000 citations → 1.0
    recency: float = 0.5
    recency_half_life_years: float = 5.0
    similarity: float = 1.0

    def __post_init__(self) -> None:
        if self.recency_half_life_years <= 0:
            raise ValueError("recency_half_life_years must be positive")
        weights = [*self.kinds.values(), *self.intents.values()]
        weights += [self.rating, self.shelf, self.intent, self.citations, self.recency]
        if any(w < 0 for w in [*weights, self.similarity]):
            raise ValueError("weights must be non-negative (monotonicity depends on it)")


DEFAULT_WEIGHTS = Weights()


@dataclass(frozen=True, slots=True)
class Source:
    """How a candidate was reached: its kind and the shelf paper it came from."""

    kind: str  # a `CandidateSource` value
    document_id: UUID | None = None


@dataclass(frozen=True, slots=True)
class CandidateFacts:
    key: str  # stable identity for tie-breaks: the OpenAlex id, or the candidate row id
    sources: tuple[Source, ...]
    shelf_citers: int = 0  # distinct shelf papers whose bibliography cites it
    intents: tuple[str, ...] = ()  # `CitationIntent` values, one per citing shelf paper
    cited_by_count: int | None = None
    year: int | None = None
    similarity: float | None = None  # max cosine to your highly rated papers, if computed


@dataclass(frozen=True, slots=True)
class Scored:
    key: str
    score: float
    parts: dict[str, float]  # `score_parts`: every name in PARTS, even when 0
    facts: CandidateFacts


def score(
    facts: CandidateFacts,
    *,
    ratings: Mapping[UUID, int],
    current_year: int,
    weights: Weights = DEFAULT_WEIGHTS,
) -> Scored:
    """Score one candidate. `ratings`: your latest stars (1-5) per shelf document."""
    raw = {
        "source": _source(facts.sources, weights),
        "rating": _rating(facts.sources, ratings, weights),
        "shelf": weights.shelf * math.log2(1 + max(0, facts.shelf_citers)),
        "intent": _intent(facts.intents, weights),
        "citations": weights.citations * math.log10(1 + max(0, facts.cited_by_count or 0)),
        "recency": _recency(facts.year, current_year, weights),
        "similarity": weights.similarity * max(0.0, facts.similarity or 0.0),
    }
    parts = {name: round(raw[name], _DIGITS) + 0.0 for name in PARTS}  # + 0.0: no -0.0
    return Scored(
        key=facts.key, score=round(sum(parts.values()), _DIGITS), parts=parts, facts=facts
    )


def rank(
    candidates: Iterable[CandidateFacts],
    *,
    ratings: Mapping[UUID, int],
    current_year: int,
    weights: Weights = DEFAULT_WEIGHTS,
) -> list[Scored]:
    """Score every candidate and order them best first, ties broken deterministically."""
    scored = [
        score(c, ratings=ratings, current_year=current_year, weights=weights) for c in candidates
    ]
    return sorted(
        scored,
        key=lambda s: (
            -s.score,
            -s.facts.shelf_citers,
            -(s.facts.cited_by_count or 0),
            s.key,
        ),
    )


def _source(sources: tuple[Source, ...], weights: Weights) -> float:
    kinds = {s.kind for s in sources}
    unknown = kinds - weights.kinds.keys()
    if unknown:
        raise ValueError(f"Unknown source kind(s): {sorted(unknown)}")
    return sum(weights.kinds[k] for k in sorted(kinds))


def _rating(sources: tuple[Source, ...], ratings: Mapping[UUID, int], weights: Weights) -> float:
    stars = [ratings[d] for s in sources if (d := s.document_id) is not None and d in ratings]
    if not stars:
        return 0.0
    best = max(stars)
    if not 1 <= best <= 5:
        raise ValueError(f"Stars must be 1-5, got {best}")
    return weights.rating * (best - 3) / 2


def _intent(intents: tuple[str, ...], weights: Weights) -> float:
    unknown = set(intents) - weights.intents.keys()
    if unknown:
        raise ValueError(f"Unknown citation intent(s): {sorted(unknown)}")
    return weights.intent * math.log1p(sum(weights.intents[i] for i in sorted(intents)))


def _recency(year: int | None, current_year: int, weights: Weights) -> float:
    if year is None:
        return 0.0
    age = max(0, current_year - year)
    return weights.recency * math.pow(0.5, age / weights.recency_half_life_years)

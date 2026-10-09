"""Scoring feed candidates (docs/PILLS.md §6). Pure: no database, a seeded RNG.

    score = scope_match * novelty * (1 + kind_affinity) * spacing * draft_penalty

* `scope_match` (≥ 1): set by the scope (a freshly read unit, extra matching concepts, a
  long-overdue review weigh more);
* `novelty`: 0.15 for a pill you have seen before; the "its unit was already served this
  session" part is applied by the mixer, which knows the order (`mixer.UNIT_REPEAT`);
* `kind_affinity` ∈ [-0.5, 0.5]: from the last 30 days of dwell, skip, save, too_easy and
  confusing per kind (`affinity`);
* `spacing`: drops with how many pills of the same unit you saw in the last day;
* `draft_penalty`: 0.8 when the source artifact is not approved yet.

Two `confusing` marks on one pill sink it (* 0.05). A small seeded jitter (± 3 %) breaks
ties so two sessions over the same shelf do not open identically, yet a seed replays.
"""

import random
import uuid
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from enum import StrEnum

from app.models.enums import PillKind

SEEN_NOVELTY = 0.15
DRAFT_PENALTY = 0.8
CONFUSING_SINK = 2
SUNK = 0.05
SPACING_STEP = 0.2
JITTER = 0.03
AFFINITY_LIMIT = 0.5
AFFINITY_MIN_SAMPLE = 4  # below this many views a kind's signals are damped


class Bucket(StrEnum):
    """Where a candidate counts in the mix (`mixer.TARGETS`)."""

    MAIN = "main"  # new pills from the units in scope
    REVIEW = "review"  # due review items
    CONNECTION = "connection"  # cross-document connection pills
    SERENDIPITY = "serendipity"  # explore: pills of documents you have not started


@dataclass(frozen=True, slots=True)
class Candidate:
    """What ranking and mixing need of a pill (or a due review item)."""

    id: uuid.UUID
    kind: PillKind
    document_id: uuid.UUID
    anchor: str  # the unit
    active: bool
    bucket: Bucket = Bucket.MAIN
    thread_key: str | None = None
    thread_index: int | None = None
    draft: bool = False
    scope_match: float = 1.0
    seen: int = 0  # times seen before (all sessions)
    confusing: int = 0  # `confusing` marks on it
    unit_recent: int = 0  # pills of its unit seen in the last day

    @property
    def unit(self) -> tuple[uuid.UUID, str]:
        return (self.document_id, self.anchor)


@dataclass(frozen=True, slots=True)
class KindSignals:
    """Counts of one kind's events over the affinity window."""

    seen: int = 0
    long_dwells: int = 0
    saves: int = 0
    skips: int = 0
    too_easy: int = 0
    confusing: int = 0


def affinity(signals: KindSignals) -> float:
    """How much you have liked a kind lately, in [-0.5, 0.5]; 0 without history."""
    raw = (
        signals.saves
        + 0.5 * signals.long_dwells
        - 0.5 * signals.skips
        - 0.75 * signals.too_easy
        - 0.5 * signals.confusing
    )
    value = raw / max(signals.seen, AFFINITY_MIN_SAMPLE)
    return max(-AFFINITY_LIMIT, min(AFFINITY_LIMIT, value))


def score(candidate: Candidate, kind_affinity: float = 0.0) -> float:
    """The candidate's score before jitter (module docstring)."""
    novelty = SEEN_NOVELTY if candidate.seen > 0 else 1.0
    spacing = 1.0 / (1.0 + SPACING_STEP * candidate.unit_recent)
    draft = DRAFT_PENALTY if candidate.draft else 1.0
    value = candidate.scope_match * novelty * (1.0 + kind_affinity) * spacing * draft
    return value * SUNK if candidate.confusing >= CONFUSING_SINK else value


@dataclass(frozen=True, slots=True)
class Ranked:
    candidate: Candidate
    score: float


def rank(
    candidates: Iterable[Candidate],
    *,
    seed: int,
    signals: Mapping[PillKind, KindSignals] | None = None,
) -> list[Ranked]:
    """Candidates by descending score; equal scores fall back to the id (deterministic)."""
    affinities = {kind: affinity(s) for kind, s in (signals or {}).items()}
    rng = random.Random(seed)  # noqa: S311  (ordering, not security)
    ranked = [
        Ranked(c, score(c, affinities.get(c.kind, 0.0)) * (1.0 + rng.uniform(-JITTER, JITTER)))
        for c in sorted(candidates, key=lambda c: c.id)
    ]
    ranked.sort(key=lambda r: (-r.score, r.candidate.id))
    return ranked

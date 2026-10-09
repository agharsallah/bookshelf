"""Assembling a run of pills from ranked candidates (docs/PILLS.md §6). Pure and deterministic.

Rules, in order of precedence:

1. **Threads stay together and in order**: picking any pill of a thread emits every
   remaining pill of it, lowest index first (a thread may run past `n` and past the
   active rhythm: it is one story).
2. **At least every 4th pill is active** (quiz, flip, review, math with `try_it`), when an
   active candidate is left.
3. **No two consecutive pills from the same unit**, unless they are one thread, when
   another unit is left.
4. **The mix**: each slot goes to the bucket furthest below its target share (~60 % main,
   20 % due reviews, 10 % connections, 10 % serendipity); an empty bucket gives its slot to
   the next one. Within a bucket the best score wins, discounted by `UNIT_REPEAT` per pill
   of the same unit already served this session (the novelty "unit seen" term).

`history` is what the session already served (its tail sets the rhythm and the last unit;
all of it counts towards the mix and the unit discount).
"""

from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field

from app.pills.feed.rank import Bucket, Candidate, Ranked

TARGETS: Mapping[Bucket, float] = {
    Bucket.MAIN: 0.6,
    Bucket.REVIEW: 0.2,
    Bucket.CONNECTION: 0.1,
    Bucket.SERENDIPITY: 0.1,
}
ACTIVE_EVERY = 4
UNIT_REPEAT = 0.5


@dataclass(slots=True)
class _State:
    out: list[Candidate] = field(default_factory=list)
    buckets: Counter[Bucket] = field(default_factory=Counter)
    units: Counter[tuple[object, str]] = field(default_factory=Counter)
    last: Candidate | None = None
    inactive_run: int = 0
    total: int = 0

    def push(self, candidate: Candidate) -> None:
        self.buckets[candidate.bucket] += 1
        self.units[candidate.unit] += 1
        self.inactive_run = 0 if candidate.active else self.inactive_run + 1
        self.last = candidate
        self.total += 1


def _bucket_order(state: _State, targets: Mapping[Bucket, float]) -> list[Bucket]:
    """Buckets by how far below their share they are (ties: `targets` order)."""
    position = {b: i for i, b in enumerate(targets)}
    deficit = {b: share * (state.total + 1) - state.buckets[b] for b, share in targets.items()}
    return sorted(targets, key=lambda b: (-deficit[b], position[b]))


def _repeats(candidate: Candidate, last: Candidate) -> bool:
    """Same unit as the pill before, and not the same thread."""
    same_thread = candidate.thread_key is not None and candidate.thread_key == last.thread_key
    return candidate.unit == last.unit and not same_thread


def _best(
    pool: Sequence[Ranked], bucket: Bucket, state: _State, *, active: bool, spaced: bool
) -> Ranked | None:
    best: Ranked | None = None
    best_value = -1.0
    last = state.last
    for entry in pool:
        c = entry.candidate
        if c.bucket is not bucket or (active and not c.active):
            continue
        if spaced and last is not None and _repeats(c, last):
            continue
        value = entry.score * UNIT_REPEAT ** state.units[c.unit]
        if value > best_value:
            best, best_value = entry, value
    return best


def _thread(pool: list[Ranked], picked: Ranked) -> list[Ranked]:
    key = picked.candidate.thread_key
    if key is None:
        return [picked]
    members = [r for r in pool if r.candidate.thread_key == key]
    return sorted(members, key=lambda r: (r.candidate.thread_index or 0, r.candidate.id))


def mix(
    ranked: Sequence[Ranked],
    n: int,
    *,
    history: Sequence[Candidate] = (),
    targets: Mapping[Bucket, float] = TARGETS,
) -> list[Candidate]:
    """Up to `n` candidates (more when a thread runs over), in serving order."""
    state = _State()
    for served in history:
        state.push(served)
    pool = [r for r in ranked if r.candidate.bucket in targets]
    while len(state.out) < n and pool:
        order = _bucket_order(state, targets)
        need_active = state.inactive_run >= ACTIVE_EVERY - 1
        picked = None
        for active, spaced in ((need_active, True), (need_active, False), (False, False)):
            picked = next(
                (p for b in order if (p := _best(pool, b, state, active=active, spaced=spaced))),
                None,
            )
            if picked is not None:
                break
        if picked is None:  # pragma: no cover - the last pass always finds one
            break
        for entry in _thread(pool, picked):
            pool.remove(entry)
            state.push(entry.candidate)
            state.out.append(entry.candidate)
    return state.out

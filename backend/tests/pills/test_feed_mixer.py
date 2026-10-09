"""Mixing ranked candidates into a run (`app.pills.feed.mixer`): pure and deterministic."""

import uuid
from collections import Counter
from typing import Any

from app.models.enums import PillKind
from app.pills.feed.mixer import mix
from app.pills.feed.rank import Bucket, Candidate, Ranked, rank

DOC = uuid.UUID(int=1)
_ids = iter(range(1, 10_000))


def cand(anchor: str = "ch01", *, active: bool = False, **fields: Any) -> Candidate:
    base: dict[str, Any] = {
        "id": uuid.UUID(int=next(_ids)),
        "kind": PillKind.QUIZ if active else PillKind.INSIGHT,
        "document_id": DOC,
        "anchor": anchor,
        "active": active,
    }
    return Candidate(**(base | fields))


def ranked(*candidates: Candidate) -> list[Ranked]:
    """In the given order, scores descending."""
    return [Ranked(c, 100.0 - i) for i, c in enumerate(candidates)]


def units(run: list[Candidate]) -> list[str]:
    return [c.anchor for c in run]


def test_every_fourth_pill_is_active_when_one_is_left():
    passive = [cand(f"ch{i:02d}") for i in range(1, 13)]
    active = [cand(f"ch{i:02d}", active=True) for i in range(20, 24)]
    run = mix(ranked(*passive, *active), 16, targets={Bucket.MAIN: 1.0})
    flags = [c.active for c in run]
    assert len(run) == 16
    for i in range(len(flags) - 3):
        assert any(flags[i : i + 4]), flags


def test_the_rhythm_carries_over_from_the_session_history():
    history = [cand("ch90"), cand("ch91"), cand("ch92")]
    run = mix(ranked(cand("ch01"), cand("ch02", active=True)), 1, history=history)
    assert run[0].active


def test_no_two_consecutive_pills_from_one_unit():
    pool = [cand("ch01") for _ in range(4)] + [cand("ch02") for _ in range(4)]
    run = mix(ranked(*pool), 8, targets={Bucket.MAIN: 1.0})
    assert all(a != b for a, b in zip(units(run), units(run)[1:], strict=False))


def test_one_unit_left_is_still_served():
    run = mix(ranked(cand("ch01"), cand("ch01")), 2, targets={Bucket.MAIN: 1.0})
    assert units(run) == ["ch01", "ch01"]


def test_a_thread_stays_together_and_in_order():
    t = [cand("ch03", thread_key="arc", thread_index=i, scope_match=1.0) for i in (2, 0, 3, 1)]
    other = [cand("ch01"), cand("ch02"), cand("ch04")]
    # the thread's index 2 ranks first: the whole thread follows from index 0
    run = mix(ranked(t[0], *other, t[1], t[2], t[3]), 6, targets={Bucket.MAIN: 1.0})
    keyed = [c.thread_index for c in run if c.thread_key == "arc"]
    assert keyed == [0, 1, 2, 3]
    start = next(i for i, c in enumerate(run) if c.thread_key == "arc")
    assert all(c.thread_key == "arc" for c in run[start : start + 4])


def test_a_thread_may_run_past_n():
    t = [cand("ch03", thread_key="arc", thread_index=i) for i in range(4)]
    run = mix(ranked(*t), 2, targets={Bucket.MAIN: 1.0})
    assert len(run) == 4


def test_the_mix_follows_the_bucket_targets():
    main = [cand(f"ch{i % 7:02d}", active=i % 3 == 0) for i in range(60)]
    reviews = [cand(f"ch{i:02d}", active=True, bucket=Bucket.REVIEW) for i in range(20, 40)]
    links = [cand(f"ch{i:02d}", bucket=Bucket.CONNECTION) for i in range(40, 50)]
    lucky = [cand(f"ch{i:02d}", bucket=Bucket.SERENDIPITY) for i in range(50, 60)]
    run = mix(ranked(*main, *reviews, *links, *lucky), 40)
    counts = Counter(c.bucket for c in run)
    assert counts[Bucket.MAIN] >= 22
    assert 6 <= counts[Bucket.REVIEW] <= 10
    assert 3 <= counts[Bucket.CONNECTION] <= 5
    assert 3 <= counts[Bucket.SERENDIPITY] <= 5


def test_an_empty_bucket_gives_its_slots_away():
    run = mix(ranked(*[cand(f"ch{i:02d}") for i in range(10)]), 10)
    assert len(run) == 10


def test_buckets_outside_the_targets_are_never_served():
    pool = ranked(cand("ch01"), cand("ch02", bucket=Bucket.REVIEW, active=True))
    assert [c.bucket for c in mix(pool, 5, targets={Bucket.REVIEW: 1.0})] == [Bucket.REVIEW]


def test_a_unit_already_served_this_session_sinks():
    history = [cand("ch01"), cand("ch02")]
    pool = [Ranked(cand("ch01"), 1.0), Ranked(cand("ch05"), 0.9), Ranked(cand("ch06"), 0.1)]
    run = mix(pool, 1, history=history, targets={Bucket.MAIN: 1.0})
    assert units(run) == ["ch05"]


def test_mixing_ranked_candidates_replays_with_a_seed():
    pool = [cand(f"ch{i % 5:02d}", active=i % 4 == 0) for i in range(30)]
    first = mix(rank(pool, seed=42), 20)
    again = mix(rank(list(reversed(pool)), seed=42), 20)
    assert [c.id for c in first] == [c.id for c in again]

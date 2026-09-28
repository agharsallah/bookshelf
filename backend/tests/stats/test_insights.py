"""Insight rules: each fires on the figures it is about, and stays quiet under its
threshold or its minimum sample."""

from app.schemas.stats import (
    ChapterStats,
    DurationStats,
    InsightArea,
    JobCounts,
    Severity,
    SkillStats,
    TimeTotals,
    TokenTotals,
)
from app.stats.insights import Context, insights

HOUR = 3_600_000


def skill(name: str = "distil-section", **overrides) -> SkillStats:
    fields = {
        "skill": name, "versions": ["1"], "tiers": ["distil"], "models": [],
        "jobs": JobCounts(total=20, done=20), "calls": 20,
        "tokens": TokenTotals(tokens=100_000), "duration": DurationStats(),
        "failure_rate": 0.0, "cache_hit_rate": 0.0, "schema_retry_rate": 0.0,
        "repair_rate": 0.0, "needs_review_rate": 0.0, "grounding_mean": 0.95,
        "grounding_min": 0.9, "words_out_mean": 200.0, "tokens_per_output_word": 25.0,
        "prompt_chars_mean": 8000.0, "artifacts": 20, "flags": [], "errors": [],
    }  # fmt: skip
    return SkillStats(**(fields | overrides))


def chapter(anchor: str, tokens_per_1k_words: float) -> ChapterStats:
    return ChapterStats(
        anchor=anchor, title=anchor, ordinal=0, page_from=None, page_to=None, pages=None,
        words=1000, sections=1, elements=0, jobs=JobCounts(), calls=1, tokens=1,
        compute_ms=1, ms_by_kind={}, tokens_per_1k_words=tokens_per_1k_words,
        seconds_per_page=None, grounding=None, needs_review=0, words_out=0,
    )  # fmt: skip


def run(*skills: SkillStats, **overrides) -> list:
    fields = {
        "subject": "meadows-systems", "skills": list(skills),
        "tokens": TokenTotals(tokens=100_000, tracked_calls=10), "time": TimeTotals(),
        "concurrency": 2, "timeout_ms": 900_000,
    }  # fmt: skip
    return insights(Context(**(fields | overrides)))


def titles(found: list) -> list[str]:
    return [i.title for i in found]


def test_a_failing_skill_is_a_reliability_problem_ranked_first():
    failing = skill(
        jobs=JobCounts(total=10, done=7, failed=3), failure_rate=0.3,
        errors=[{"name": "claude timed out after #s", "count": 3}],
    )  # fmt: skip

    [first, *_] = run(failing)

    assert (first.severity, first.area) == (Severity.HIGH, InsightArea.RELIABILITY)
    assert "30%" in first.title and "timed out" in first.detail


def test_small_samples_raise_nothing():
    tiny = skill(jobs=JobCounts(total=2, done=1, failed=1), failure_rate=0.5, artifacts=1,
                 schema_retry_rate=1.0)  # fmt: skip

    assert run(tiny) == []


def test_frequent_schema_retries_point_at_the_prompt():
    found = run(skill(schema_retry_rate=0.4))

    assert any(i.metric == "schema_retry_rate" and i.value == 0.4 for i in found)


def test_a_clean_expensive_skill_is_a_tier_down_candidate():
    clean = skill("write-brief", tiers=["reason"], grounding_mean=0.99)

    [only] = run(clean)

    assert (only.area, only.subject) == (InsightArea.COST, "write-brief")
    assert "cheaper" in only.title


def test_runs_near_the_timeout_are_flagged_before_the_tail():
    slow = skill(duration=DurationStats(count=10, p50_ms=60_000, p95_ms=500_000,
                                        max_ms=800_000))  # fmt: skip

    [only] = [i for i in run(slow) if i.area is not InsightArea.COST]

    assert only.metric == "max_ms" and only.severity is Severity.HIGH


def test_a_skill_with_most_of_the_tokens_is_the_cost_driver():
    heavy = skill("distil-section", tokens=TokenTotals(tokens=80_000))
    light = skill("summarize", tokens=TokenTotals(tokens=20_000))

    found = [i for i in run(heavy, light) if i.metric == "token_share"]

    assert [(i.subject, i.value) for i in found] == [("distil-section", 0.8)]


def test_serial_running_with_spare_slots_is_a_throughput_problem():
    time = TimeTotals(active_ms=HOUR, compute_ms=HOUR, parallelism=1.0)

    found = run(time=time)

    assert [i.metric for i in found] == ["parallelism"]


def test_an_expensive_chapter_stands_out_against_the_median():
    chapters = [chapter(f"ch0{i}", 1000) for i in range(1, 5)] + [chapter("ch05", 3500)]

    found = run(chapters=chapters)

    assert [(i.subject, i.metric) for i in found] == [("ch05", "tokens_per_1k_words")]


def test_history_without_per_call_telemetry_says_so():
    found = run(tokens=TokenTotals(tokens=5000, tracked_calls=0))

    assert [i.area for i in found] == [InsightArea.TELEMETRY]

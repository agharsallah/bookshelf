"""Per-skill figures: attribution, rates from gate reports, tokens, errors, models."""

from app.models.enums import JobKind, JobState
from app.stats import skills
from app.stats.tokens import token_totals
from tests.stats.builders import artifact, call, job

KIND_SKILLS = {JobKind.SUMMARIZE: "summarize", JobKind.LINK_CONCEPTS: "link-concepts"}


def test_a_job_runs_the_skill_it_names_else_its_modes_else_its_kinds():
    assert skills.skill_of(job(skill="make-quiz", kind=JobKind.DERIVE), KIND_SKILLS) == "make-quiz"
    dedup = job(JobKind.LINK_CONCEPTS, mode="dedup")
    assert skills.skill_of(dedup, KIND_SKILLS) == "confirm-merge"
    assert skills.skill_of(job(JobKind.LINK_CONCEPTS), KIND_SKILLS) == "link-concepts"
    assert skills.skill_of(job(JobKind.PARSE), KIND_SKILLS) is None


def test_errors_group_by_signature_with_ids_and_numbers_blanked():
    a = skills.error_signature("claude timed out after 900s\ntraceback…")
    b = skills.error_signature("claude timed out after 600s")
    uuid_error = skills.error_signature("recall 6f1c1c1e-2d4b-4c1e-9a55-0d3e4b7a1c2f missing")

    assert a == b == "claude timed out after #s"
    assert uuid_error == "recall <id> missing"


def test_skill_rates_come_from_jobs_and_gate_reports():
    jobs = [
        *(job(state=JobState.DONE) for _ in range(3)),
        job(state=JobState.FAILED, error="output rejected after one retry: x"),
        job(state=JobState.SKIPPED, start=None),
    ]
    made = [
        artifact(schema_retry=True, grounding=0.8, flags=("grounding_below_min",)),
        artifact(repairs=2, grounding=1.0, flags=("duplicate_of:ch01/s02",)),
        artifact(grounding=0.9, words=300),
    ]

    [stats] = skills.all_skill_stats(jobs, [], made, KIND_SKILLS)

    assert stats.skill == "summarize"
    assert (stats.jobs.done, stats.jobs.failed, stats.jobs.skipped) == (3, 1, 1)
    assert stats.failure_rate == 0.25
    assert stats.cache_hit_rate == 0.25
    assert stats.schema_retry_rate == 0.333
    assert stats.repair_rate == 0.333
    assert stats.needs_review_rate == 0.667
    assert (stats.grounding_mean, stats.grounding_min) == (0.9, 0.8)
    assert [f.name for f in stats.flags] == ["grounding_below_min", "duplicate_of"]
    assert stats.errors[0].name == "output rejected after one retry: x"
    assert stats.tokens_per_output_word == 6.0  # 3000 tokens over 500 words


def test_recorded_calls_replace_the_job_row_and_failed_attempts_are_waste():
    first_try = job(state=JobState.DONE, attempts=2, tokens=999)
    calls = [
        call(first_try, attempt=1, input_tokens=700, output_tokens=300),  # the failed attempt
        call(first_try, attempt=2, input_tokens=1500, output_tokens=500),
    ]

    totals = token_totals([first_try], calls)

    assert totals.tokens == 3000  # both calls, not the job row's 999
    assert totals.wasted_tokens == 1000
    assert totals.cache_read_tokens == 10_000
    assert totals.cost_usd == 0.02
    assert totals.tracked_calls == 2


def test_models_count_recorded_calls_and_older_jobs_alike():
    tracked = job(model="claude-sonnet-5")
    older = job(model="claude-haiku-4-5", tokens=400)

    stats = skills.model_stats([tracked, older], [call(tracked, model="claude-sonnet-5")])

    assert [(m.model, m.calls, m.tokens) for m in stats] == [
        ("claude-sonnet-5", 1, 1000),
        ("claude-haiku-4-5", 1, 400),
    ]

"""Time: the three clocks, passes, stage spans and the ETA, on hand-made facts."""

from datetime import timedelta

from app.models.enums import JobKind, JobState
from app.stats import timeline
from app.stats.numbers import durations, percentile
from tests.stats.builders import at, call, job


def test_percentile_interpolates_between_ranks():
    assert percentile([10, 20, 30, 40], 50) == 25
    assert percentile([5], 95) == 5
    assert percentile([], 50) is None


def test_durations_summarize_and_ignore_missing_values():
    stats = durations([1000, None, 3000, 2000])

    assert (stats.count, stats.total_ms, stats.p50_ms, stats.max_ms) == (3, 6000, 2000, 3000)


def test_overlapping_runs_count_once_in_active_time_but_fully_in_compute():
    jobs = [job(start=0, minutes=10), job(start=5, minutes=10), job(start=30, minutes=5)]

    time = timeline.time_totals(jobs, [])

    assert time.active_ms == 20 * 60_000  # 0-15 and 30-35
    assert time.compute_ms == 25 * 60_000
    assert time.wall_ms == 35 * 60_000
    assert time.parallelism == 1.25
    assert time.model_ms is None  # no recorded calls


def test_wait_is_measured_from_queued_to_started_on_first_attempts():
    queued_early = job(start=10, created_at=at(4))
    retried = job(start=20, created_at=at(0), attempts=2)

    time = timeline.time_totals([queued_early, retried], [])

    assert time.wait.count == 1
    assert time.wait.p50_ms == 6 * 60_000


def test_an_idle_gap_longer_than_the_threshold_starts_a_new_pass():
    ingest = [job(JobKind.PARSE, start=0), job(JobKind.SUMMARIZE, start=1, minutes=20)]
    rerun = [job(JobKind.DERIVE, start=120)]

    passes = timeline.passes([*ingest, *rerun], [], gap=timedelta(minutes=30))

    assert [(p.jobs, p.includes_parse) for p in passes] == [(2, True), (1, False)]
    assert passes[0].wall_ms == 21 * 60_000
    assert timeline.end_to_end(passes) is passes[0]


def test_end_to_end_is_the_pass_that_parsed_the_book():
    early = job(JobKind.DERIVE, start=0)
    reparse = job(JobKind.PARSE, start=500)

    passes = timeline.passes([early, reparse], [])

    first = timeline.end_to_end(passes)
    assert first is not None and first.includes_parse


def test_stages_come_in_pipeline_order_with_offsets_from_the_pass_start():
    jobs = [
        job(JobKind.DISTIL_CHAPTER, start=30, minutes=5),
        job(JobKind.PARSE, start=0, minutes=1),
        job(JobKind.SUMMARIZE, start=2, minutes=10),
    ]
    summarize = jobs[2]

    [only] = timeline.passes(jobs, [call(summarize, input_tokens=4000, output_tokens=1000)])

    assert [s.kind for s in only.stages] == [
        JobKind.PARSE,
        JobKind.SUMMARIZE,
        JobKind.DISTIL_CHAPTER,
    ]
    distil = only.stages[2]
    assert (distil.start_offset_ms, distil.end_offset_ms) == (30 * 60_000, 35 * 60_000)
    assert only.stages[1].tokens == 5000  # recorded calls win over the job row


def test_the_eta_prices_queued_work_at_each_kinds_median_across_the_slots():
    jobs = [
        job(JobKind.SUMMARIZE, start=None, state=JobState.QUEUED),
        job(JobKind.SUMMARIZE, start=None, state=JobState.QUEUED),
        job(JobKind.BRIEF, start=None, state=JobState.QUEUED),
        job(JobKind.SUMMARIZE, start=0, state=JobState.RUNNING, finished_at=None),
    ]
    medians = {JobKind.SUMMARIZE: 60_000.0, JobKind.BRIEF: 180_000.0}

    left = timeline.remaining(jobs, slots=2, medians=medians)

    assert (left.queued, left.running) == (3, 1)
    assert left.eta_ms == 150_000  # (60 + 60 + 180) s over 2 slots


def test_no_eta_without_any_history():
    queued = job(start=None, state=JobState.QUEUED)

    assert timeline.remaining([queued], slots=2, medians={}).eta_ms is None


def test_a_stage_reports_when_it_was_busy_not_just_its_first_and_last_moment():
    jobs = [
        job(JobKind.PARSE, start=0, minutes=1),
        job(JobKind.PARSE, start=60, minutes=1),  # a re-parse an hour later, same pass
        job(JobKind.SUMMARIZE, start=1, minutes=59),
    ]

    [only] = timeline.passes(jobs, [], gap=timedelta(hours=2))

    parse = only.stages[0]
    assert parse.span_ms == 61 * 60_000
    assert parse.busy_ms == 2 * 60_000
    assert parse.segments == [(0, 60_000), (3_600_000, 3_660_000)]


def test_too_many_segments_close_their_shortest_gaps():
    jobs = [job(start=i * 10, minutes=1) for i in range(5)] + [job(start=41.5, minutes=1)]

    segments = timeline.busy_segments(jobs, origin=at(0), limit=5)

    assert len(segments) == 5
    assert segments[-1] == (40 * 60_000, int(42.5 * 60_000))  # the 30 s gap closed first

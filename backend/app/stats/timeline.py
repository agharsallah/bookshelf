"""Time: how long a book took end to end, how busy the pipeline was, what is left.

Three clocks, because they answer different questions:

    wall     first job queued → last job finished     (how long did I wait?)
    active   time at least one job was running          (how long was the pipeline busy?)
    compute  sum of job run times                       (how much work was it?)

`compute / active` is the parallelism the worker slots actually achieved.

A **pass** is a burst of activity: jobs whose runs lie no more than `gap` apart. The first
pass that parsed the book is its initial end-to-end run; later passes are re-runs,
derived study material, a resumed ceiling.
"""

from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from datetime import datetime, timedelta

from app.models.enums import JobKind, JobState
from app.schemas.stats import PipelinePass, Remaining, StageSpan, TimeTotals
from app.stats.facts import CallFact, JobFact
from app.stats.numbers import durations, percentile, ratio, rounded
from app.stats.tokens import calls_by_job, job_counts, job_tokens

DEFAULT_GAP = timedelta(minutes=30)
MAX_SEGMENTS = 60  # busy segments per stage, enough for a Gantt row
_KIND_ORDER = {kind: i for i, kind in enumerate(JobKind)}  # declared in pipeline order


def _ms(delta: timedelta) -> int:
    return max(int(delta.total_seconds() * 1000), 0)


def run_intervals(jobs: Iterable[JobFact]) -> list[tuple[datetime, datetime]]:
    return [
        (j.started_at, j.finished_at)
        for j in jobs
        if j.started_at is not None and j.finished_at is not None
    ]


def merged(intervals: Iterable[tuple[datetime, datetime]]) -> list[tuple[datetime, datetime]]:
    """The union of intervals as disjoint, ordered intervals: overlapping runs merge."""
    out: list[tuple[datetime, datetime]] = []
    for start, end in sorted(intervals):
        if out and start <= out[-1][1]:
            out[-1] = (out[-1][0], max(out[-1][1], end))
        else:
            out.append((start, end))
    return out


def union_ms(intervals: Iterable[tuple[datetime, datetime]]) -> int:
    """Length of the union of intervals: overlapping runs count once."""
    return sum(_ms(end - start) for start, end in merged(intervals))


def busy_segments(
    jobs: Iterable[JobFact], origin: datetime, limit: int = MAX_SEGMENTS
) -> list[tuple[int, int]]:
    """When a stage was actually running, as `(start, end)` ms offsets from `origin`.
    Beyond `limit` segments the shortest gaps are closed, so a chart stays drawable."""
    segments = merged(run_intervals(jobs))
    while len(segments) > limit:
        gaps = [segments[i + 1][0] - segments[i][1] for i in range(len(segments) - 1)]
        i = gaps.index(min(gaps))
        segments[i : i + 2] = [(segments[i][0], segments[i + 1][1])]
    return [(_ms(start - origin), _ms(end - origin)) for start, end in segments]


def time_totals(jobs: Sequence[JobFact], calls: Sequence[CallFact]) -> TimeTotals:
    finished = [j.finished_at for j in jobs if j.finished_at is not None]
    wall = _ms(max(finished) - min(j.created_at for j in jobs)) if finished else 0
    active = union_ms(run_intervals(jobs))
    compute = sum(j.duration_ms or 0 for j in jobs if j.ran)
    waits = [
        _ms(j.started_at - j.created_at)
        for j in jobs
        if j.started_at is not None and j.attempts <= 1
    ]
    return TimeTotals(
        wall_ms=wall,
        active_ms=active,
        compute_ms=compute,
        model_ms=sum(c.duration_ms for c in calls) if calls else None,
        parallelism=rounded(ratio(compute, active), 2),
        wait=durations(waits),
    )


def stage_spans(
    jobs: Sequence[JobFact],
    calls: Sequence[CallFact],
    *,
    origin: datetime | None = None,
) -> list[StageSpan]:
    """One span per job kind, in pipeline order; offsets are from `origin` when given."""
    by_kind: dict[JobKind, list[JobFact]] = defaultdict(list)
    for job in jobs:
        by_kind[job.kind].append(job)
    by_job = calls_by_job(calls)
    spans = []
    for kind in sorted(by_kind, key=_KIND_ORDER.__getitem__):
        group = by_kind[kind]
        ran = [j for j in group if j.ran]
        started = min((j.started_at for j in ran if j.started_at), default=None)
        finished = max((j.finished_at for j in ran if j.finished_at), default=None)
        spans.append(
            StageSpan(
                kind=kind,
                jobs=job_counts(group),
                started_at=started,
                finished_at=finished,
                start_offset_ms=_ms(started - origin) if origin and started else None,
                end_offset_ms=_ms(finished - origin) if origin and finished else None,
                span_ms=_ms(finished - started) if started and finished else None,
                busy_ms=union_ms(run_intervals(ran)),
                segments=busy_segments(ran, origin) if origin else [],
                compute_ms=sum(j.duration_ms or 0 for j in ran),
                duration=durations(j.duration_ms for j in ran if j.state is JobState.DONE),
                tokens=sum(job_tokens(j, by_job.get(j.id, [])) for j in group),
            )
        )
    return spans


def split_passes(jobs: Sequence[JobFact], gap: timedelta = DEFAULT_GAP) -> list[list[JobFact]]:
    """Group jobs that ran into bursts separated by more than `gap` of idleness."""
    ran = sorted((j for j in jobs if j.ran), key=lambda j: j.started_at or j.created_at)
    groups: list[list[JobFact]] = []
    end: datetime | None = None
    for job in ran:
        start, finish = job.started_at, job.finished_at
        if start is None or finish is None:  # excluded by `ran`; narrows the types
            continue
        if end is None or start > end + gap:
            groups.append([])
            end = finish
        groups[-1].append(job)
        end = max(end, finish)
    return groups


def passes(
    jobs: Sequence[JobFact], calls: Sequence[CallFact], gap: timedelta = DEFAULT_GAP
) -> list[PipelinePass]:
    by_job = calls_by_job(calls)
    out = []
    for index, group in enumerate(split_passes(jobs, gap)):
        ids = {j.id for j in group}
        group_calls = [c for c in calls if c.job_id in ids]
        started = min(j.started_at for j in group if j.started_at)
        finished = max(j.finished_at for j in group if j.finished_at)
        out.append(
            PipelinePass(
                index=index,
                started_at=started,
                finished_at=finished,
                wall_ms=_ms(finished - started),
                active_ms=union_ms(run_intervals(group)),
                compute_ms=sum(j.duration_ms or 0 for j in group),
                jobs=len(group),
                tokens=sum(job_tokens(j, by_job.get(j.id, [])) for j in group),
                includes_parse=any(j.kind is JobKind.PARSE for j in group),
                stages=stage_spans(group, group_calls, origin=started),
            )
        )
    return out


def end_to_end(all_passes: Sequence[PipelinePass]) -> PipelinePass | None:
    """The book's initial run: the first pass that parsed it (else the first pass)."""
    return next((p for p in all_passes if p.includes_parse), all_passes[0] if all_passes else None)


def median_by_kind(jobs: Iterable[JobFact]) -> dict[JobKind, float]:
    grouped: dict[JobKind, list[float]] = defaultdict(list)
    for job in jobs:
        if job.state is JobState.DONE and job.duration_ms is not None:
            grouped[job.kind].append(job.duration_ms)
    return {kind: p for kind, values in grouped.items() if (p := percentile(values, 50))}


def remaining(
    jobs: Sequence[JobFact], slots: int, medians: Mapping[JobKind, float] | None = None
) -> Remaining:
    """Work still ahead, with an estimate: each queued job at its kind's median run time
    (from `medians`, else this book's own history), shared across `slots` workers."""
    queued = [j for j in jobs if j.state is JobState.QUEUED]
    running = sum(1 for j in jobs if j.state is JobState.RUNNING)
    known = dict(medians) if medians is not None else median_by_kind(jobs)
    fallback = percentile(list(known.values()), 50)
    estimates = [known.get(j.kind, fallback) for j in queued]
    eta = None
    if queued and all(e is not None for e in estimates):
        eta = round(sum(e for e in estimates if e is not None) / max(slots, 1))
    return Remaining(queued=len(queued), running=running, eta_ms=eta)

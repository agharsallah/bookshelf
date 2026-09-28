"""Token and cost totals over jobs and their recorded CLI calls.

`tokens` (input + output) is summed per job: a job with recorded calls counts all of
them, failed attempts included; a job from before per-call telemetry counts its
`cost_tokens`. The cache, cost and wasted figures exist only for recorded calls.
"""

import uuid
from collections import defaultdict
from collections.abc import Iterable, Sequence

from app.models.enums import JobState
from app.schemas.stats import JobCounts, TokenTotals
from app.stats.facts import CallFact, JobFact


def job_counts(jobs: Iterable[JobFact]) -> JobCounts:
    counts = JobCounts()
    for job in jobs:
        counts.total += 1
        setattr(counts, job.state.value, getattr(counts, job.state.value) + 1)
    return counts


def calls_by_job(calls: Iterable[CallFact]) -> dict[uuid.UUID | None, list[CallFact]]:
    grouped: dict[uuid.UUID | None, list[CallFact]] = defaultdict(list)
    for call in calls:
        grouped[call.job_id].append(call)
    return grouped


def job_tokens(job: JobFact, calls: Sequence[CallFact]) -> int:
    """What one job cost in tokens: its recorded calls when they report counts (failed
    attempts included), else what the job row says."""
    if any(c.counted for c in calls):
        return sum(c.tokens for c in calls)
    return job.tokens or 0


def is_wasted(call: CallFact, job: JobFact | None) -> bool:
    """A call whose attempt produced nothing: its job failed, or a later attempt redid it."""
    if job is None:
        return False
    return job.state is JobState.FAILED or call.attempt < job.attempts


def _sum(values: Iterable[int | None]) -> int | None:
    known = [v for v in values if v is not None]
    return sum(known) if known else None


def token_totals(jobs: Sequence[JobFact], calls: Sequence[CallFact]) -> TokenTotals:
    by_job = calls_by_job(calls)
    jobs_by_id: dict[uuid.UUID | None, JobFact] = {j.id: j for j in jobs}
    costs = [c.cost_usd for c in calls if c.cost_usd is not None]
    return TokenTotals(
        tokens=sum(job_tokens(j, by_job.get(j.id, [])) for j in jobs),
        input_tokens=_sum(c.input_tokens for c in calls),
        output_tokens=_sum(c.output_tokens for c in calls),
        cache_read_tokens=_sum(c.cache_read_tokens for c in calls),
        cache_write_tokens=_sum(c.cache_write_tokens for c in calls),
        cost_usd=round(sum(costs), 6) if costs else None,
        wasted_tokens=(
            sum(c.tokens for c in calls if is_wasted(c, jobs_by_id.get(c.job_id)))
            if calls
            else None
        ),
        tracked_calls=len(calls),
    )

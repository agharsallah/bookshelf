"""Activity over the calendar: what the pipeline did each day, for the library's time view.

A job counts on the day it finished (UTC), with its whole run time and tokens; cost comes
from recorded calls on the day they were made. Only days with activity are returned, the
chart fills the gaps.
"""

from collections import defaultdict
from collections.abc import Sequence
from datetime import date

from app.models.enums import JobState
from app.schemas.stats import ActivityDay
from app.stats.facts import CallFact, JobFact
from app.stats.tokens import calls_by_job, job_tokens


def daily(jobs: Sequence[JobFact], calls: Sequence[CallFact]) -> list[ActivityDay]:
    """One row per day something finished or a call was made, oldest first."""
    by_job = calls_by_job(calls)
    days: dict[date, ActivityDay] = {}
    books: dict[date, set[object]] = defaultdict(set)

    def row(day: date) -> ActivityDay:
        return days.setdefault(day, ActivityDay(day=day))

    for job in jobs:
        if not job.ran or job.finished_at is None:
            continue
        day = job.finished_at.date()
        entry = row(day)
        ms = job.duration_ms or 0
        entry.jobs += 1
        entry.compute_ms += ms
        entry.tokens += job_tokens(job, by_job.get(job.id, []))
        if job.state is JobState.FAILED:
            entry.failed += 1
            entry.failed_ms += ms
        if job.document_id is not None:
            books[day].add(job.document_id)
    for call in calls:
        if call.cost_usd is None:
            continue
        entry = row(call.created_at.date())
        entry.cost_usd = round((entry.cost_usd or 0) + call.cost_usd, 6)
    for day, ids in books.items():
        days[day].books = len(ids)
    return [days[d] for d in sorted(days)]

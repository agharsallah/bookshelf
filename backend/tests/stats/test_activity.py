"""Activity by day: jobs on the day they finished, failures and cost kept apart."""

import uuid
from datetime import timedelta

from app.models.enums import JobState
from app.stats import activity
from tests.stats.builders import T0, call, job

DAY = 24 * 60


def test_jobs_count_on_the_day_they_finished_with_their_run_time_and_tokens():
    book = uuid.uuid4()
    late = job(start=DAY - 30, minutes=60, document_id=book)  # finishes the next day
    early = job(start=0, minutes=10, document_id=book, tokens=500)

    days = activity.daily([late, early], [])

    assert [d.day for d in days] == [T0.date(), (T0 + timedelta(days=1)).date()]
    assert (days[0].jobs, days[0].compute_ms, days[0].tokens, days[0].books) == (1, 600_000, 500, 1)
    assert days[1].compute_ms == 60 * 60_000


def test_failed_time_is_split_out_and_unran_jobs_are_left_out():
    failed = job(start=0, minutes=5, state=JobState.FAILED)
    done = job(start=10, minutes=2)
    queued = job(start=None, state=JobState.QUEUED)

    [day] = activity.daily([failed, done, queued], [])

    assert (day.jobs, day.failed, day.compute_ms, day.failed_ms) == (2, 1, 7 * 60_000, 5 * 60_000)


def test_cost_comes_from_calls_on_the_day_they_were_made():
    ran = job(start=0)
    calls = [call(ran, cost_usd=0.25), call(ran, cost_usd=0.5), call(ran, cost_usd=None)]

    [day] = activity.daily([ran], calls)

    assert day.cost_usd == 0.75
    assert day.tokens == 3000  # three recorded calls replace the job row's 1000


def test_no_work_no_days():
    assert activity.daily([], []) == []

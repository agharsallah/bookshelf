"""Nullable JSONB columns store Python None as SQL NULL, so `IS NULL` filters work."""

from sqlalchemy import text
from sqlmodel import Session

from app.jobs import queue
from app.jobs.queue import JobSpec
from app.models.enums import JobKind


def test_a_job_result_of_none_is_sql_null(session: Session):
    job = queue.enqueue(session, JobSpec(kind=JobKind.EXPORT))
    assert job is not None
    for value in ({"nodes": 3}, None):  # a real transition, so the ORM writes the None
        job.result = value
        session.add(job)
        session.commit()

    is_null = session.execute(
        text("select result is null from jobs where id = :id"), {"id": job.id}
    ).scalar_one()

    assert is_null is True

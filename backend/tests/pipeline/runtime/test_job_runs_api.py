"""`GET /jobs/{id}/runs`: a job's run log, one entry per CLI call over all its attempts."""

import uuid
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.jobs import queue
from app.jobs.queue import JobSpec
from app.models import Job, ModelRun
from app.models.enums import JobKind


def enqueue(session: Session, anchor: str) -> Job:
    job = queue.enqueue(session, JobSpec(kind=JobKind.EXPORT, anchor=anchor))
    assert job is not None
    return job


def run(job: Job, attempt: int, call: int, at: datetime, **values: object) -> ModelRun:
    return ModelRun(job_id=job.id, kind=job.kind, attempt=attempt, call=call, created_at=at,
                    duration_ms=1200, prompt_chars=500, **values)  # type: ignore[arg-type]  # fmt: skip


def test_the_run_log_lists_every_call_of_the_job_oldest_first(session: Session, client: TestClient):
    job, other = enqueue(session, "a"), enqueue(session, "b")
    start = datetime.now(UTC)
    session.add_all([
        run(job, 2, 1, start + timedelta(seconds=30), ok=True, model="sonnet", input_tokens=900),
        run(job, 1, 1, start, ok=False, error="schema: <root>: bad"),
        run(other, 1, 1, start, ok=True),
    ])  # fmt: skip
    session.commit()

    response = client.get(f"/api/v1/jobs/{job.id}/runs")

    assert response.status_code == 200
    log = response.json()
    assert [(r["attempt"], r["ok"], r["error"]) for r in log] == [
        (1, False, "schema: <root>: bad"),
        (2, True, None),
    ]
    assert (log[1]["model"], log[1]["input_tokens"]) == ("sonnet", 900)


def test_a_job_that_called_no_model_has_an_empty_log(session: Session, client: TestClient):
    job = enqueue(session, "a")

    assert client.get(f"/api/v1/jobs/{job.id}/runs").json() == []


def test_the_run_log_of_an_unknown_job_is_not_found(client: TestClient):
    assert client.get(f"/api/v1/jobs/{uuid.uuid4()}/runs").status_code == 404


def test_the_live_log_pages_by_offset(session: Session, client: TestClient):
    from app.telemetry import run_log

    job = enqueue(session, "a")
    with run_log.job_log(job.id, attempt=1):
        run_log.event("started")
        run_log.text("text", "Hello")
    url = f"/api/v1/jobs/{job.id}/log"

    first = client.get(url).json()
    with run_log.job_log(job.id, attempt=1):
        run_log.event("finished", state="done")
    since = client.get(url, params={"after": first["next"]}).json()

    assert [(e["type"], e.get("text")) for e in first["events"]] == [
        ("started", None),
        ("text", "Hello"),
    ]
    assert [e["type"] for e in since["events"]] == ["finished"]
    assert client.get(f"/api/v1/jobs/{uuid.uuid4()}/log").status_code == 404

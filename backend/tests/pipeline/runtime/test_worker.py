"""The worker loop (`--once` drain, failure mapping, autodiscovery), the SSE job stream,
and the outbox import CLI."""

import json
import threading
from pathlib import Path

from sqlmodel import Session, select

from app.jobs import queue
from app.jobs.queue import JobSpec
from app.jobs.registry import HandlerResult, JobContext, PermanentJobError
from app.jobs.worker import Worker, autodiscover
from app.models import Artifact, Job
from app.models.enums import JobKind, JobState, RunMode
from app.pipeline import interactive
from app.pipeline.execution import prepare
from app.pipeline.skills import load_catalogue
from tests.pipeline.runtime.conftest import body, paragraph


def jobs_by_anchor(session: Session) -> dict[str | None, Job]:
    session.expire_all()
    return {j.anchor: j for j in session.exec(select(Job))}


def test_once_drains_the_queue_in_parallel_including_follow_up_work(session: Session):
    for anchor in ("a", "b", "c"):
        queue.enqueue(session, JobSpec(kind=JobKind.EXPORT, anchor=anchor))
    seen: list[str] = []
    lock = threading.Lock()

    def export(ctx: JobContext) -> HandlerResult:
        with lock:
            seen.append(ctx.job.anchor or "")
        return HandlerResult(result={"anchor": ctx.job.anchor})

    def follow_up(db: Session, job: Job) -> None:
        if job.anchor == "a":
            queue.enqueue(db, JobSpec(kind=JobKind.EXPORT, anchor="a-next"))

    worker = Worker(
        concurrency=2, poll_seconds=0.01, handlers={JobKind.EXPORT: export}, on_done=follow_up
    )

    assert worker.run(once=True) == 4
    jobs = jobs_by_anchor(session)
    assert sorted(seen) == ["a", "a-next", "b", "c"]
    assert {j.state for j in jobs.values()} == {JobState.DONE}
    assert jobs["b"].result == {"anchor": "b"}


def test_permanent_errors_fail_at_once_and_others_are_retried_later(session: Session):
    queue.enqueue(session, JobSpec(kind=JobKind.EXPORT, anchor="bad-input"))
    queue.enqueue(session, JobSpec(kind=JobKind.EXPORT, anchor="flaky"))
    done: list[JobState] = []

    def export(ctx: JobContext) -> HandlerResult:
        if ctx.job.anchor == "bad-input":
            raise PermanentJobError("schema violation")
        raise RuntimeError("CLI rate limited")

    worker = Worker(
        concurrency=1,
        poll_seconds=0.01,
        handlers={JobKind.EXPORT: export},
        on_done=lambda db, job: done.append(job.state),
    )

    assert worker.run(once=True) == 2
    jobs = jobs_by_anchor(session)
    assert (jobs["bad-input"].state, jobs["bad-input"].error) == (
        JobState.FAILED,
        "schema violation",
    )
    assert (jobs["flaky"].state, jobs["flaky"].attempts) == (JobState.QUEUED, 1)
    assert jobs["flaky"].error == "RuntimeError: CLI rate limited"
    assert done == [JobState.FAILED]  # a job waiting for its retry is not "done" yet


def test_only_kinds_with_a_handler_are_claimed(session: Session):
    queue.enqueue(session, JobSpec(kind=JobKind.EMBED))
    worker = Worker(
        concurrency=1, poll_seconds=0.01, handlers={JobKind.EXPORT: lambda ctx: HandlerResult()}
    )

    assert worker.run(once=True) == 0
    assert jobs_by_anchor(session)[None].state is JobState.QUEUED


def test_autodiscover_imports_every_module_of_the_package(tmp_path: Path, monkeypatch):
    package = tmp_path / "fake_handlers"
    package.mkdir()
    (package / "__init__.py").write_text("")
    (package / "export_handler.py").write_text("LOADED = True\n")
    monkeypatch.syspath_prepend(str(tmp_path))

    assert autodiscover("fake_handlers") == ["fake_handlers.export_handler"]


def test_job_stream_sends_a_snapshot_then_ends(client, session: Session):
    job = queue.enqueue(session, JobSpec(kind=JobKind.EXPORT, anchor="ch01"))
    assert job is not None

    with client.stream("GET", "/api/v1/jobs/stream", params={"max_seconds": 0}) as response:
        text = "".join(response.iter_text())

    events = [
        dict(line.split(": ", 1) for line in chunk.splitlines())
        for chunk in text.split("\n\n")
        if chunk.startswith("event:")
    ]
    assert response.headers["content-type"].startswith("text/event-stream")
    assert [e["event"] for e in events] == ["job", "end"]
    assert json.loads(events[0]["data"])["id"] == str(job.id)
    assert json.loads(events[0]["data"])["state"] == "queued"


def test_outbox_file_imports_as_an_interactive_artifact(session, book, skills_dir, tmp_path):
    skill = load_catalogue(skills_dir)["summarize"]
    current = prepare(session, skill, book, "ch02").input_hash
    outbox = tmp_path / "summarize-meadows-systems-ch02.json"
    outbox.write_text(json.dumps({
        "skill": "summarize", "document": "meadows-systems", "anchor": "ch02",
        "input_hash": current, "output": body(paragraph("Loops seek goals.", "ch02/p001")),
    }))  # fmt: skip

    artifact = interactive.import_file(session, outbox, skills_dir=skills_dir)

    assert session.exec(select(Artifact)).one().id == artifact.id
    assert artifact.run_mode is RunMode.INTERACTIVE


def test_import_cli_reports_failures_with_a_non_zero_exit(tmp_path: Path, capsys):
    broken = tmp_path / "broken.json"
    broken.write_text("{not json")

    assert interactive.main(["import", str(broken)]) == 1
    assert "FAIL" in capsys.readouterr().err

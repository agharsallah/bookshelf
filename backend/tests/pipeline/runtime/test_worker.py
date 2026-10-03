"""The worker loop (`--once` drain, failure mapping, autodiscovery), the SSE job stream,
and the outbox import CLI."""

import argparse
import json
import threading
import time
from collections.abc import Callable
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from sqlmodel import Session, select

from app.api.routes import job_events
from app.core.config import get_settings
from app.db.session import engine
from app.jobs import queue
from app.jobs.narration import NarrateRunner
from app.jobs.queue import JobSpec
from app.jobs.registry import HandlerResult, JobContext, PermanentJobError
from app.jobs.worker import Worker, autodiscover, kind_filters, parse_kinds
from app.jobs.runners import _job_worker
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


def _lock_age_seconds(job_id: object) -> float:
    with Session(engine) as db:
        age = db.execute(
            text("select extract(epoch from now() - locked_at) from jobs where id = :id"),
            {"id": job_id},
        ).scalar_one()
    return float(age)


def test_a_job_outliving_the_stale_timeout_is_not_reclaimed_while_its_worker_lives(
    session: Session,
):
    queue.enqueue(session, JobSpec(kind=JobKind.EXPORT, anchor="long-cli-run"))
    reclaimed: list[Job | None] = []

    def export(ctx: JobContext) -> HandlerResult:
        # Pretend this run has taken an hour (a long `claude` call): the lock looks stale.
        with Session(engine) as other:
            other.execute(
                text("update jobs set locked_at = now() - interval '1 hour' where id = :id"),
                {"id": ctx.job.id},
            )
            other.commit()
            deadline = time.monotonic() + 5
            while _lock_age_seconds(ctx.job.id) > 60 and time.monotonic() < deadline:
                threading.Event().wait(0.01)
            reclaimed.append(queue.claim(other, [JobKind.EXPORT]))
        return HandlerResult()

    worker = Worker(
        concurrency=1, poll_seconds=0.01, heartbeat_seconds=0.01, handlers={JobKind.EXPORT: export}
    )

    assert worker.run(once=True) == 1
    job = jobs_by_anchor(session)["long-cli-run"]
    assert reclaimed == [None]  # a second worker must not run it again
    assert (job.state, job.attempts) == (JobState.DONE, 1)


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
    assert [e["event"] for e in events] == ["queue", "job", "end"]
    health = json.loads(events[0]["data"])
    assert (health["workers"], health["queued"], health["unclaimed_kinds"]) == ([], 1, ["export"])
    sent = json.loads(events[1]["data"])
    assert (sent["id"], sent["state"], sent["queue_position"]) == (str(job.id), "queued", 1)


def failing_once[**P, R](fn: Callable[P, R]) -> Callable[P, R]:
    """`fn`, except that its first call raises what a dropped connection raises."""
    calls = 0

    def wrapped(*args: P.args, **kwargs: P.kwargs) -> R:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise OperationalError("select 1", {}, Exception("Can't assign requested address"))
        return fn(*args, **kwargs)

    return wrapped


def test_the_loop_outlives_a_dropped_database_connection(session: Session, monkeypatch):
    queue.enqueue(session, JobSpec(kind=JobKind.EXPORT, anchor="after-the-blip"))

    def export(ctx: JobContext) -> HandlerResult:
        worker.stop.set()
        return HandlerResult()

    worker = Worker(concurrency=1, poll_seconds=0.01, handlers={JobKind.EXPORT: export})
    monkeypatch.setattr(worker, "claim", failing_once(worker.claim))

    assert worker.run() == 1
    assert jobs_by_anchor(session)["after-the-blip"].state == JobState.DONE


def test_the_job_stream_retries_a_failed_poll_instead_of_ending(client, session, monkeypatch):
    queue.enqueue(session, JobSpec(kind=JobKind.EXPORT, anchor="ch01"))
    monkeypatch.setattr(job_events, "_poll", failing_once(job_events._poll))
    monkeypatch.setattr(job_events, "POLL_SECONDS", 0.01)

    with client.stream("GET", "/api/v1/jobs/stream", params={"max_seconds": 0.2}) as response:
        text = "".join(response.iter_text())

    events = [
        line.removeprefix("event: ") for line in text.splitlines() if line.startswith("event:")
    ]
    assert events == ["queue", "job", "end"]


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


def test_excluded_kinds_stay_queued_while_the_rest_run(session: Session):
    queue.enqueue(session, JobSpec(kind=JobKind.EMBED, anchor="vectors"))
    queue.enqueue(session, JobSpec(kind=JobKind.EXPORT, anchor="bundle"))
    handlers = {kind: lambda ctx: HandlerResult() for kind in (JobKind.EMBED, JobKind.EXPORT)}
    worker = Worker(concurrency=1, poll_seconds=0.01, handlers=handlers, exclude=[JobKind.EMBED])

    assert worker.run(once=True) == 1
    jobs = jobs_by_anchor(session)
    assert (jobs["vectors"].state, jobs["bundle"].state) == (JobState.QUEUED, JobState.DONE)


@pytest.mark.parametrize(
    ("only", "embedded", "expected_exclude"),
    [
        (None, True, [JobKind.NARRATE, JobKind.EMBED]),  # the API owns embedded Qdrant
        (None, False, [JobKind.NARRATE]),  # a Qdrant server: the worker embeds
        ([JobKind.EMBED], True, [JobKind.NARRATE]),  # explicit `--kinds embed` wins
        ([JobKind.NARRATE], False, []),  # explicit `--kinds narrate` wins too
    ],
)
def test_worker_cli_leaves_embed_to_the_api_only_for_embedded_qdrant(
    only, embedded, expected_exclude
):
    assert kind_filters(only, [], qdrant_embedded=embedded) == (only, expected_exclude)


def test_worker_cli_parsesparse_kindss_and_rejects_unknown_kinds():
    assert parse_kinds("parse, summarize") == [JobKind.PARSE, JobKind.SUMMARIZE]
    with pytest.raises(argparse.ArgumentTypeError):
        parse_kinds("parse,teleport")


def test_the_api_narrate_runner_claims_narrate_jobs_only_one_at_a_time(session: Session):
    queue.enqueue(session, JobSpec(kind=JobKind.NARRATE, anchor="episode"))
    queue.enqueue(session, JobSpec(kind=JobKind.EXPORT, anchor="bundle"))
    handlers = {kind: lambda ctx: HandlerResult() for kind in (JobKind.NARRATE, JobKind.EXPORT)}
    runner = NarrateRunner(poll_seconds=0.01, handlers=handlers)

    assert runner.worker.run(once=True) == 1
    jobs = jobs_by_anchor(session)
    assert (jobs["episode"].state, jobs["bundle"].state) == (JobState.DONE, JobState.QUEUED)
    assert runner.worker.concurrency == 1


@pytest.mark.parametrize("qdrant_url", [None, "http://qdrant:6333"])
def test_the_api_pipeline_worker_leaves_narrate_to_its_own_runner(qdrant_url):
    settings = get_settings().model_copy(update={"api_worker": True, "qdrant_url": qdrant_url})

    background = _job_worker(settings)

    assert background is not None
    kinds = background.worker.kinds()
    assert JobKind.NARRATE not in kinds
    assert JobKind.DERIVE in kinds
    assert (JobKind.EMBED in kinds) is (qdrant_url is not None)

"""Run logs: one JSON-lines file per job, written on its thread, tailed by offset."""

import json
import os
import time
import uuid
from datetime import timedelta
from pathlib import Path

import pytest

from app.models.enums import Tier
from app.pipeline import cli_stream
from app.pipeline.runner import FakeRunner, run_structured
from app.telemetry import run_log


@pytest.fixture
def logs(tmp_path: Path) -> Path:
    return tmp_path / "logs"


def types(events: list[dict]) -> list[str]:
    return [e["type"] for e in events]


def test_events_go_to_the_current_jobs_log_and_nowhere_outside_one(logs: Path):
    job = uuid.uuid4()
    run_log.event("stray")  # no job: a no-op

    with run_log.job_log(job, attempt=2, directory=logs):
        run_log.event("started", kind="derive")

    events, _ = run_log.read(job, directory=logs)
    assert types(events) == ["started"]
    assert (events[0]["attempt"], events[0]["kind"]) == (2, "derive")
    assert list(logs.iterdir()) == [run_log.log_path(job, logs)]


def test_text_deltas_are_joined_into_one_line_until_another_kind_of_event(logs: Path):
    job = uuid.uuid4()
    with run_log.job_log(job, attempt=1, directory=logs):
        for chunk in ("Hel", "lo", ""):
            run_log.text("text", chunk)
        run_log.text("thinking", "hmm")
        run_log.event("reply", ok=True)

    events, _ = run_log.read(job, directory=logs)
    assert [(e["type"], e.get("text")) for e in events] == [
        ("text", "Hello"),
        ("thinking", "hmm"),
        ("reply", None),
    ]


def test_reading_from_an_offset_returns_only_what_came_since_and_never_half_a_line(logs: Path):
    job = uuid.uuid4()
    with run_log.job_log(job, attempt=1, directory=logs):
        run_log.event("started")
    first, offset = run_log.read(job, directory=logs)
    with run_log.log_path(job, logs).open("a") as handle:
        handle.write(json.dumps({"type": "call"}) + "\n" + '{"type": "rep')  # mid-write

    since, later = run_log.read(job, after=offset, directory=logs)

    assert types(first) == ["started"]
    assert types(since) == ["call"]
    assert run_log.read(job, after=later, directory=logs) == ([], later)


def test_a_job_that_never_ran_has_an_empty_log(logs: Path):
    assert run_log.read(uuid.uuid4(), directory=logs) == ([], 0)


def test_a_full_log_says_so_once_and_stops_growing(logs: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(run_log, "MAX_BYTES", 400)
    job = uuid.uuid4()
    with run_log.job_log(job, attempt=1, directory=logs):
        for i in range(20):
            run_log.event("tool", name=f"Read {i}", input="x" * 40)

    events, _ = run_log.read(job, directory=logs)
    assert types(events)[-1] == "truncated"
    assert types(events).count("truncated") == 1
    assert run_log.log_path(job, logs).stat().st_size < 600


def test_prune_removes_only_logs_older_than_the_cutoff(logs: Path):
    old, fresh = uuid.uuid4(), uuid.uuid4()
    for job in (old, fresh):
        with run_log.job_log(job, attempt=1, directory=logs):
            run_log.event("started")
    stale = time.time() - timedelta(days=30).total_seconds()
    os.utime(run_log.log_path(old, logs), (stale, stale))

    assert run_log.prune(older_than=timedelta(days=14), directory=logs) == 1
    assert [p.stem for p in logs.iterdir()] == [str(fresh)]


def test_the_schema_gate_logs_a_rejected_reply_then_the_accepted_retry(logs: Path):
    job = uuid.uuid4()
    runner = FakeRunner("not json", '{"title": "ok"}')
    with run_log.job_log(job, attempt=1, directory=logs):
        run_structured(runner, "P", tier=Tier.DISTIL, validate=lambda _o: [])

    events, _ = run_log.read(job, directory=logs)
    assert types(events) == ["rejected", "accepted"]
    assert events[0]["retrying"] is True and events[1]["retried"] is True


def test_tool_use_and_its_result_are_logged_but_whole_messages_do_not_repeat_the_text(logs: Path):
    job = uuid.uuid4()
    lines = [
        {"type": "assistant", "message": {"content": [
            {"type": "text", "text": "Looking at the figure"},
            {"type": "tool_use", "name": "Read", "input": {"file_path": "/m/f1.png"}},
        ]}},
        {"type": "user", "message": {"content": [
            {"type": "tool_result", "content": "image bytes", "is_error": False},
        ]}},
        {"type": "rate_limit_event", "rate_limit_info": {"status": "allowed"}},
        "not json",
    ]  # fmt: skip
    with run_log.job_log(job, attempt=1, directory=logs):
        for line in lines:
            cli_stream.decode(line if isinstance(line, str) else json.dumps(line))

    events, _ = run_log.read(job, directory=logs)
    assert types(events) == ["tool", "tool_result"]
    assert (events[0]["name"], events[0]["input"]) == ("Read", '{"file_path": "/m/f1.png"}')


def test_the_envelope_is_the_last_result_line_of_a_stream_or_the_whole_json():
    envelope = json.dumps({"type": "result", "result": "x"})
    stream = "\n".join([json.dumps({"type": "system"}), envelope, ""])

    assert cli_stream.result_line(stream) == envelope
    assert cli_stream.result_line('{"result": "x"}') == '{"result": "x"}'
    assert cli_stream.result_line("garbage") == "garbage"

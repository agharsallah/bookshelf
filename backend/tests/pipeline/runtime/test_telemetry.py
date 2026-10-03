"""Telemetry: every CLI call a job makes leaves one `model_runs` row, failures included."""

from collections.abc import Sequence
from pathlib import Path

import pytest
from sqlmodel import Session, select

from app.jobs import queue
from app.jobs.registry import PermanentJobError
from app.models import Document, ModelRun
from app.models.enums import JobKind, Tier
from app.pipeline.execution import execute_skill_job
from app.pipeline.runner import FakeRunner, RunnerError, RunResult
from app.telemetry.recorder import recorded
from tests.pipeline.runtime.conftest import body, paragraph, reply

GROUNDED = reply(body(paragraph("A stock remembers its flows.", "ch01/s01/p001")))


class MeteredReply:
    """A runner whose one reply carries the usage and cost a real CLI envelope has."""

    def run(self, prompt: str, *, tier: Tier, images: Sequence[Path] = ()) -> RunResult:
        usage = {
            "input_tokens": 1200,
            "output_tokens": 300,
            "cache_read_input_tokens": 9000,
            "cache_creation_input_tokens": 400,
        }
        return RunResult(text=GROUNDED, model="claude-sonnet-5", cost_tokens=1500,
                         duration_ms=4200, usage=usage, cost_usd=0.021, api_ms=3900,
                         turns=1)  # fmt: skip


class Broken:
    def run(self, prompt: str, *, tier: Tier, images: Sequence[Path] = ()) -> RunResult:
        raise RunnerError("claude timed out after 600s")


def runs_of(session: Session) -> list[ModelRun]:
    session.expire_all()
    return list(session.exec(select(ModelRun).order_by(ModelRun.call)))


def test_a_successful_run_records_tokens_cost_and_model_time(
    session: Session, book: Document, make_job, skills_dir: Path
):
    job = make_job(JobKind.SUMMARIZE, book, "ch01")
    queue.claim(session)
    session.refresh(job)

    execute_skill_job(session, job, runner=recorded(MeteredReply(), job), skills_dir=skills_dir)

    [run] = runs_of(session)
    assert (run.job_id, run.document_id, run.kind) == (job.id, book.id, JobKind.SUMMARIZE)
    assert (run.skill, run.tier, run.model, run.ok) == ("summarize", Tier.EXPLORE,
                                                        "claude-sonnet-5", True)  # fmt: skip
    assert (run.input_tokens, run.output_tokens) == (1200, 300)
    assert (run.cache_read_tokens, run.cache_write_tokens) == (9000, 400)
    assert run.cost_usd == pytest.approx(0.021)
    assert (run.duration_ms, run.api_ms, run.turns) == (4200, 3900, 1)
    assert run.prompt_chars > 0 and run.reply_chars == len(GROUNDED)


def test_a_schema_retry_is_a_second_call_of_the_same_attempt(
    session: Session, book: Document, make_job, skills_dir: Path
):
    job = make_job(JobKind.SUMMARIZE, book, "ch01")
    queue.claim(session)
    session.refresh(job)
    runner = recorded(FakeRunner("not json", GROUNDED), job)

    execute_skill_job(session, job, runner=runner, skills_dir=skills_dir)

    assert [(r.attempt, r.call, r.ok) for r in runs_of(session)] == [(1, 1, True), (1, 2, True)]


def test_a_failed_call_is_recorded_even_though_the_job_rolls_back(
    session: Session, book: Document, make_job, skills_dir: Path
):
    job = make_job(JobKind.SUMMARIZE, book, "ch01")
    queue.claim(session)
    session.refresh(job)

    with pytest.raises(RunnerError):
        execute_skill_job(session, job, runner=recorded(Broken(), job), skills_dir=skills_dir)
    session.rollback()

    [run] = runs_of(session)
    assert run.ok is False
    assert run.error == "claude timed out after 600s"
    assert run.input_tokens is None


def test_a_telemetry_failure_never_fails_the_job(
    session: Session, book: Document, make_job, skills_dir: Path
):
    job = make_job(JobKind.SUMMARIZE, book, "ch01")
    queue.claim(session)
    session.refresh(job)

    def no_database() -> Session:
        raise ConnectionError("database is gone")

    runner = recorded(FakeRunner(GROUNDED), job, sessions=no_database)
    try:
        outcome = execute_skill_job(session, job, runner=runner, skills_dir=skills_dir)
    except PermanentJobError as exc:  # pragma: no cover - the assertion below explains
        pytest.fail(f"telemetry failed the job: {exc}")

    assert outcome.result["artifact_id"]
    assert runs_of(session) == []


def test_each_call_logs_its_prompt_then_the_reply_the_skill_returned(
    session: Session, book: Document, make_job, skills_dir: Path, tmp_path: Path
):
    from app.telemetry import run_log

    job = make_job(JobKind.SUMMARIZE, book, "ch01")
    queue.claim(session)
    session.refresh(job)

    with run_log.job_log(job.id, attempt=1, directory=tmp_path):
        execute_skill_job(session, job, runner=recorded(MeteredReply(), job), skills_dir=skills_dir)

    events, _ = run_log.read(job.id, directory=tmp_path)
    call, reply_event = (e for e in events if e["type"] in ("call", "reply"))
    assert (call["call"], call["tier"]) == (1, "explore")
    assert call["prompt_chars"] == len(call["prompt"]) > 0  # the whole prompt, as sent
    assert (reply_event["ok"], reply_event["model"], reply_event["text"]) == (
        True, "claude-sonnet-5", GROUNDED,
    )  # fmt: skip


def test_a_failed_call_logs_its_error(session: Session, book: Document, make_job, tmp_path: Path):
    from app.telemetry import run_log

    job = make_job(JobKind.SUMMARIZE, book, "ch01")
    with run_log.job_log(job.id, attempt=1, directory=tmp_path), pytest.raises(RunnerError):
        recorded(Broken(), job).run("P", tier=Tier.DISTIL)

    events, _ = run_log.read(job.id, directory=tmp_path)
    assert [(e["type"], e.get("ok"), e.get("error")) for e in events] == [
        ("call", None, None),
        ("reply", False, "claude timed out after 600s"),
    ]

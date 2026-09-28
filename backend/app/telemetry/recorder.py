"""Record every CLI call a job makes as a `model_runs` row.

    runner = recorded(default_runner(), job)          # in a job handler
    ceiling.metered(runner, ...)                      # the ceiling wraps it, unchanged

`RecordingRunner` is a `ModelRunner` decorator: it times the call, reads the token counts,
cost and model time out of the `RunResult` (or notes the `RunnerError`), and writes one row
in its **own short session**. So a job that fails and rolls back still leaves the tokens it
burned on record, and the job's session never carries an open transaction through a run.
A telemetry write that fails is logged and dropped: statistics never fail a job.
"""

import logging
import time
import uuid
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any

from sqlmodel import Session

from app.models import Job, ModelRun
from app.models.enums import JobKind, Tier
from app.pipeline.runner import ModelRunner, RunnerError, RunResult

logger = logging.getLogger(__name__)

_ERROR_CHARS = 500

SessionFactory = Callable[[], Session]


def _default_sessions() -> Session:
    from app.db.session import engine  # lazy: importing the engine connects settings

    return Session(engine)


def _usage_int(usage: dict[str, Any], key: str) -> int | None:
    value = usage.get(key)
    return value if isinstance(value, int) and not isinstance(value, bool) else None


class RecordingRunner:
    """A `ModelRunner` that leaves one `model_runs` row per call it passes on."""

    def __init__(
        self,
        runner: ModelRunner,
        job: Job,
        *,
        skill: str | None = None,
        sessions: SessionFactory | None = None,
    ) -> None:
        self._runner = runner
        self._job = job
        self._skill = skill
        self._job_id: uuid.UUID = job.id
        self._kind: JobKind = job.kind
        self._document_id = job.document_id
        self._attempt = max(job.attempts, 1)
        self._sessions = sessions or _default_sessions
        self._calls = 0

    def run(self, prompt: str, *, tier: Tier, images: Sequence[Path] = ()) -> RunResult:
        self._calls += 1
        started = time.monotonic()
        try:
            result = self._runner.run(prompt, tier=tier, images=images)
        except RunnerError as exc:
            elapsed = int((time.monotonic() - started) * 1000)
            self._record(self._row(prompt, tier, images, ok=False, duration_ms=elapsed,
                                   error=str(exc)[:_ERROR_CHARS]))  # fmt: skip
            raise
        usage = result.usage
        self._record(
            self._row(
                prompt,
                tier,
                images,
                ok=True,
                duration_ms=result.duration_ms,
                model=result.model,
                input_tokens=_usage_int(usage, "input_tokens"),
                output_tokens=_usage_int(usage, "output_tokens"),
                cache_read_tokens=_usage_int(usage, "cache_read_input_tokens"),
                cache_write_tokens=_usage_int(usage, "cache_creation_input_tokens"),
                cost_usd=result.cost_usd,
                api_ms=result.api_ms,
                turns=result.turns,
                reply_chars=len(result.text),
            )
        )
        return result

    def _skill_of_job(self) -> tuple[str | None, str | None]:
        """The job's skill as it is *now*: a skill job names it only once it has started."""
        try:
            return self._skill or self._job.skill, self._job.skill_version
        except Exception:  # a detached or expired job: the row is still worth keeping
            return self._skill, None

    def _row(
        self,
        prompt: str,
        tier: Tier,
        images: Sequence[Path],
        *,
        ok: bool,
        duration_ms: int,
        **fields: Any,
    ) -> ModelRun:
        skill, version = self._skill_of_job()
        return ModelRun(
            job_id=self._job_id,
            document_id=self._document_id,
            kind=self._kind,
            skill=skill,
            skill_version=version,
            tier=tier,
            attempt=self._attempt,
            call=self._calls,
            ok=ok,
            duration_ms=max(duration_ms, 0),
            prompt_chars=len(prompt),
            images=len(images),
            **fields,
        )

    def _record(self, row: ModelRun) -> None:
        try:
            with self._sessions() as session:
                session.add(row)
                session.commit()
        except Exception:
            logger.warning(
                "Model run not recorded", extra={"job_id": str(self._job_id)}, exc_info=True
            )


def recorded(
    runner: ModelRunner,
    job: Job,
    *,
    skill: str | None = None,
    sessions: SessionFactory | None = None,
) -> ModelRunner:
    """`runner`, with every call it makes for `job` recorded in `model_runs`. `skill`
    names the utility skill of a job whose row names none (dedup, bridges, grading)."""
    return RecordingRunner(runner, job, skill=skill, sessions=sessions)

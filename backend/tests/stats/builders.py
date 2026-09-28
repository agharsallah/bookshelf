"""Fact builders for the pure statistics tests: working defaults, keyword overrides."""

import uuid
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from typing import Any

from app.models.enums import JobKind, JobState, Review
from app.stats.facts import ArtifactFact, CallFact, ChapterFact, JobFact

T0 = datetime(2026, 9, 1, 9, 0, tzinfo=UTC)


def at(minutes: float) -> datetime:
    return T0 + timedelta(minutes=minutes)


def job(
    kind: JobKind = JobKind.SUMMARIZE,
    *,
    start: float | None = 0,
    minutes: float = 1,
    state: JobState = JobState.DONE,
    **overrides: Any,
) -> JobFact:
    """A job that ran from `start` for `minutes` (never ran when `start` is None)."""
    started = at(start) if start is not None else None
    finished = at(start + minutes) if start is not None else None
    fact = JobFact(
        id=uuid.uuid4(), document_id=None, kind=kind, state=state, anchor=None, skill=None,
        mode=None, attempts=1, error=None, tokens=1000, duration_ms=int(minutes * 60_000),
        model=None, created_at=started or T0, started_at=started, finished_at=finished,
    )  # fmt: skip
    return replace(fact, **overrides)


def call(for_job: JobFact | None = None, **overrides: Any) -> CallFact:
    fact = CallFact(
        job_id=for_job.id if for_job else None, document_id=None,
        kind=for_job.kind if for_job else JobKind.SUMMARIZE, skill=None, tier="explore",
        model="claude-haiku-4-5", attempt=1, call=1, ok=True, error=None, input_tokens=800,
        output_tokens=200, cache_read_tokens=5000, cache_write_tokens=0, cost_usd=0.01,
        duration_ms=60_000, prompt_chars=4000, created_at=T0,
    )  # fmt: skip
    return replace(fact, **overrides)


def artifact(skill: str = "summarize", **overrides: Any) -> ArtifactFact:
    fact = ArtifactFact(
        document_id=uuid.uuid4(), anchor=None, type="chapter_summary", skill=skill,
        skill_version="1", tier="explore", model="claude-haiku-4-5", review=Review.DRAFT,
        grounding=1.0, compression=None, words=100, schema_retry=False, repairs=0, flags=(),
        created_at=T0,
    )  # fmt: skip
    return replace(fact, **overrides)


def chapter(anchor: str, *, words: int = 1000, pages: int = 10, **overrides: Any) -> ChapterFact:
    fact = ChapterFact(
        anchor=anchor, title=f"Chapter {anchor}", position=0, page_from=1, page_to=pages,
        words=words, sections=2, elements=1, skipped=False,
    )  # fmt: skip
    return replace(fact, **overrides)

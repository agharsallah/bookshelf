"""The rows statistics are computed from, detached from the ORM (`collect` loads them)."""

import uuid
from dataclasses import dataclass, field
from datetime import datetime

from app.models import Document
from app.models.enums import JobKind, JobState, Review


@dataclass(frozen=True, slots=True)
class JobFact:
    id: uuid.UUID
    document_id: uuid.UUID | None
    kind: JobKind
    state: JobState
    anchor: str | None
    skill: str | None  # as the job row names it (set once a skill job starts)
    mode: str | None  # `payload.mode`: dedup · bridge for link_concepts
    attempts: int
    error: str | None
    tokens: int | None  # `cost_tokens`: input + output of the finishing attempt
    duration_ms: int | None
    model: str | None  # `result.model`
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None

    @property
    def ran(self) -> bool:
        """Whether it has a run interval (skipped jobs that never started have none)."""
        return self.started_at is not None and self.finished_at is not None


@dataclass(frozen=True, slots=True)
class CallFact:
    """One `model_runs` row: one CLI call."""

    job_id: uuid.UUID | None
    document_id: uuid.UUID | None
    kind: JobKind
    skill: str | None
    tier: str | None
    model: str | None
    attempt: int
    call: int
    ok: bool
    error: str | None
    input_tokens: int | None
    output_tokens: int | None
    cache_read_tokens: int | None
    cache_write_tokens: int | None
    cost_usd: float | None
    duration_ms: int
    prompt_chars: int
    created_at: datetime

    @property
    def tokens(self) -> int:
        return (self.input_tokens or 0) + (self.output_tokens or 0)

    @property
    def counted(self) -> bool:
        """Whether the CLI reported token counts (a call that failed reports none)."""
        return self.input_tokens is not None or self.output_tokens is not None


@dataclass(frozen=True, slots=True)
class ArtifactFact:
    """A skill-made artifact and its gate report (§14)."""

    document_id: uuid.UUID
    anchor: str | None
    type: str
    skill: str
    skill_version: str | None
    tier: str | None
    model: str | None
    review: Review
    grounding: float | None
    compression: float | None
    words: int | None
    schema_retry: bool
    repairs: int
    flags: tuple[str, ...]
    created_at: datetime


@dataclass(frozen=True, slots=True)
class ChapterFact:
    anchor: str
    title: str | None
    position: int  # reading order across the whole book, parts included
    page_from: int | None
    page_to: int | None
    words: int
    sections: int
    elements: int  # figures, tables, code, math
    skipped: bool

    @property
    def pages(self) -> int | None:
        if self.page_from is None or self.page_to is None:
            return None
        return self.page_to - self.page_from + 1


@dataclass(frozen=True, slots=True)
class Shape:
    """The book's size: what the per-page and per-word ratios divide by."""

    words: int = 0
    blocks: int = 0
    sections: int = 0
    elements: dict[str, int] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class BookFacts:
    document: Document
    shape: Shape
    chapters: list[ChapterFact]
    jobs: list[JobFact]
    calls: list[CallFact]
    artifacts: list[ArtifactFact]

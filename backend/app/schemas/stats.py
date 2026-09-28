"""Pipeline statistics (`GET /stats`, `GET /documents/{ref}/stats`): where tokens and
minutes go, per book, per chapter, per stage and per skill, and what to improve next.

Durations are milliseconds. `tokens` is input + output tokens, known for every job
(`jobs.cost_tokens`); the cache, cost and wasted figures come from `model_runs` and cover
only calls made since per-call telemetry started (`tracked_calls` says how many).
"""

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, Field

from app.models.enums import DocumentKind, DocumentStatus, JobKind


class JobCounts(BaseModel):
    total: int = 0
    done: int = 0
    failed: int = 0
    skipped: int = 0  # idempotency hits and cancellations: work that cost nothing
    queued: int = 0
    running: int = 0


class TokenTotals(BaseModel):
    tokens: int = Field(default=0, description="Input + output tokens of every job, all history.")
    input_tokens: int | None = None
    output_tokens: int | None = None
    cache_read_tokens: int | None = None
    cache_write_tokens: int | None = None
    cost_usd: float | None = Field(
        default=None, description="What the CLI reported (tracked calls)."
    )
    wasted_tokens: int | None = Field(
        default=None, description="Tokens of calls whose attempt produced nothing: failed jobs, "
        "attempts that were retried.",
    )  # fmt: skip
    tracked_calls: int = 0


class DurationStats(BaseModel):
    count: int = 0
    total_ms: int = 0
    mean_ms: int | None = None
    p50_ms: int | None = None
    p95_ms: int | None = None
    max_ms: int | None = None


class BookInfo(BaseModel):
    id: str
    slug: str
    title: str
    authors: list[str]
    year: int | None
    kind: DocumentKind
    status: DocumentStatus
    language: str
    parse_tier: int | None
    pages: int | None
    chapters: int
    sections: int
    blocks: int
    words: int
    elements: dict[str, int] = Field(
        default_factory=dict, description="Non-prose blocks by kind: figure, table, code, math."
    )
    created_at: datetime


class TimeTotals(BaseModel):
    wall_ms: int = Field(default=0, description="First job queued to last job finished.")
    active_ms: int = Field(default=0, description="Time at least one job was running.")
    compute_ms: int = Field(default=0, description="Sum of job run times.")
    model_ms: int | None = Field(default=None, description="Time inside CLI calls (tracked calls).")
    parallelism: float | None = Field(default=None, description="compute / active.")
    wait: DurationStats = Field(
        default_factory=DurationStats, description="Queued to started, first attempts."
    )


class Efficiency(BaseModel):
    tokens_per_page: float | None = None
    tokens_per_1k_words: float | None = None
    seconds_per_page: float | None = None
    minutes_per_10k_words: float | None = None
    cost_per_page_usd: float | None = None


class StageSpan(BaseModel):
    kind: JobKind
    jobs: JobCounts
    started_at: datetime | None
    finished_at: datetime | None
    start_offset_ms: int | None = Field(default=None, description="From the start of the pass.")
    end_offset_ms: int | None = None
    span_ms: int | None = None
    busy_ms: int = Field(default=0, description="Time at least one of its jobs was running.")
    segments: list[tuple[int, int]] = Field(
        default_factory=list,
        description="When it was running, as [start, end] ms from the pass start (passes only).",
    )
    compute_ms: int
    duration: DurationStats
    tokens: int


class PipelinePass(BaseModel):
    """A burst of pipeline activity: jobs whose runs are no more than a gap apart."""

    index: int
    started_at: datetime
    finished_at: datetime
    wall_ms: int
    active_ms: int
    compute_ms: int
    jobs: int
    tokens: int
    includes_parse: bool
    stages: list[StageSpan]


class ChapterStats(BaseModel):
    anchor: str
    title: str | None
    ordinal: int
    page_from: int | None
    page_to: int | None
    pages: int | None
    words: int
    sections: int
    elements: int
    jobs: JobCounts
    calls: int
    tokens: int
    compute_ms: int
    ms_by_kind: dict[str, int]
    tokens_per_1k_words: float | None
    seconds_per_page: float | None
    grounding: float | None
    needs_review: int
    compression: float | None = Field(default=None, description="The chapter distillation's.")
    words_out: int


class NamedCount(BaseModel):
    name: str
    count: int


class SkillStats(BaseModel):
    skill: str
    versions: list[str]
    tiers: list[str]
    models: list[str]
    jobs: JobCounts
    calls: int
    tokens: TokenTotals
    duration: DurationStats
    tokens_per_job: float | None = Field(default=None, description="Mean over done jobs.")
    failure_rate: float | None
    cache_hit_rate: float | None = Field(default=None, description="Skipped / (done + skipped).")
    schema_retry_rate: float | None
    repair_rate: float | None
    needs_review_rate: float | None
    grounding_mean: float | None
    grounding_min: float | None
    words_out_mean: float | None
    tokens_per_output_word: float | None
    prompt_chars_mean: float | None
    artifacts: int
    flags: list[NamedCount]
    errors: list[NamedCount]


class ModelStats(BaseModel):
    model: str
    tiers: list[str]
    calls: int
    tokens: int
    cost_usd: float | None
    duration: DurationStats


class Remaining(BaseModel):
    queued: int
    running: int
    eta_ms: int | None = Field(
        default=None, description="Queued work at each kind's median, divided by the worker slots."
    )


class Severity(StrEnum):
    HIGH = "high"
    MEDIUM = "medium"
    INFO = "info"


class InsightArea(StrEnum):
    COST = "cost"
    SPEED = "speed"
    RELIABILITY = "reliability"
    QUALITY = "quality"
    THROUGHPUT = "throughput"
    TELEMETRY = "telemetry"


class Insight(BaseModel):
    """One thing worth changing in a skill or the pipeline, with the number behind it."""

    severity: Severity
    area: InsightArea
    subject: str = Field(description="A skill, a chapter anchor, a book slug or `pipeline`.")
    title: str
    detail: str
    metric: str
    value: float
    threshold: float | None = None


class DocumentStats(BaseModel):
    book: BookInfo
    jobs: JobCounts
    tokens: TokenTotals
    time: TimeTotals
    efficiency: Efficiency
    end_to_end: PipelinePass | None = Field(
        default=None, description="The first pass that parsed the book: its initial end-to-end run."
    )
    passes: list[PipelinePass]
    stages: list[StageSpan]
    chapters: list[ChapterStats]
    skills: list[SkillStats]
    models: list[ModelStats]
    remaining: Remaining
    insights: list[Insight]
    telemetry_since: datetime | None
    generated_at: datetime


class BookRow(BaseModel):
    book: BookInfo
    jobs: JobCounts
    tokens: TokenTotals
    time: TimeTotals
    efficiency: Efficiency
    end_to_end_ms: int | None
    failure_rate: float | None
    remaining: Remaining
    last_activity: datetime | None


class LibraryStats(BaseModel):
    books: list[BookRow]
    jobs: JobCounts
    tokens: TokenTotals
    time: TimeTotals
    skills: list[SkillStats]
    models: list[ModelStats]
    insights: list[Insight]
    telemetry_since: datetime | None
    generated_at: datetime

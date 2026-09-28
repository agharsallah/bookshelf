"""What every insight rule reads (`Context`) and the thresholds it compares against."""

from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field

from app.schemas.stats import BookRow, ChapterStats, Insight, SkillStats, TimeTotals, TokenTotals

MINUTE_MS = 60_000


@dataclass(frozen=True, slots=True)
class Thresholds:
    min_sample: int = 5  # jobs or artifacts before a rate means anything
    failure_rate: float = 0.10
    failure_rate_high: float = 0.25
    schema_retry_rate: float = 0.15
    repair_rate: float = 0.20
    flagged_rate: float = 0.25
    grounding_floor: float = 0.90
    # A skill this clean on an expensive tier may hold up one rung down (D16).
    tier_down_sample: int = 10
    tier_down_grounding: float = 0.97
    tier_down_rates: float = 0.05
    tail_factor: float = 3.0
    tail_min_ms: int = 2 * MINUTE_MS
    timeout_share: float = 0.80
    cost_driver_share: float = 0.35
    waste_share: float = 0.10
    parallelism_floor: float = 1.3
    parallelism_min_active_ms: int = 10 * MINUTE_MS
    wait_p50_ms: int = 10 * MINUTE_MS
    outlier_factor: float = 2.0
    outlier_min_units: int = 4
    outlier_limit: int = 3


@dataclass(frozen=True, slots=True)
class Context:
    subject: str  # the book's slug, or `library`
    skills: Sequence[SkillStats]
    tokens: TokenTotals
    time: TimeTotals
    concurrency: int
    timeout_ms: int
    chapters: Sequence[ChapterStats] = ()
    books: Sequence[BookRow] = ()
    limits: Thresholds = field(default_factory=Thresholds)


Rule = Callable[[Context], Iterable[Insight]]


def pct(value: float) -> str:
    return f"{value:.0%}"


def minutes(ms: float) -> str:
    return f"{ms / MINUTE_MS:.1f} min"

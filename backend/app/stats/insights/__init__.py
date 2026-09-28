"""Rules that read the statistics and say what to change: in a skill's prompt or schema,
its tier, the pipeline's concurrency, or a chapter that parses badly.

Each rule is a plain function `(Context) -> Iterable[Insight]`, listed in `RULES`; adding
one is adding a function. Thresholds live in `Thresholds` so they are tunable in one
place (and in tests). Every insight carries the metric and value that triggered it, so a
later run can show whether a change moved the number.
"""

from collections.abc import Sequence

from app.schemas.stats import Insight, Severity
from app.stats.insights.context import Context, Rule, Thresholds
from app.stats.insights.pipeline_rules import (
    book_outliers,
    chapter_outliers,
    telemetry_gap,
    throughput,
    waste,
)
from app.stats.insights.skill_rules import (
    cost_drivers,
    flagged,
    repairs,
    schema_retries,
    skill_failures,
    slow_tail,
    tier_down,
    weak_grounding,
)

RULES: tuple[Rule, ...] = (
    skill_failures,
    weak_grounding,
    slow_tail,
    schema_retries,
    flagged,
    repairs,
    waste,
    throughput,
    cost_drivers,
    tier_down,
    chapter_outliers,
    book_outliers,
    telemetry_gap,
)

_RANK = {Severity.HIGH: 0, Severity.MEDIUM: 1, Severity.INFO: 2}


def insights(ctx: Context, rules: Sequence[Rule] = RULES) -> list[Insight]:
    """Every rule's findings, most severe first (rule order breaks ties)."""
    found = [(i, insight) for i, rule in enumerate(rules) for insight in rule(ctx)]
    return [insight for _, insight in sorted(found, key=lambda p: (_RANK[p[1].severity], p[0]))]


__all__ = ["RULES", "Context", "Rule", "Thresholds", "insights"]

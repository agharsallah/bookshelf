"""Rules about one skill at a time: reliability, output quality, speed, cost and tier."""

from collections.abc import Iterable

from app.schemas.stats import Insight, InsightArea, Severity
from app.stats.insights.context import Context, minutes, pct


def skill_failures(ctx: Context) -> Iterable[Insight]:
    t = ctx.limits
    for s in ctx.skills:
        finished = s.jobs.done + s.jobs.failed
        if s.failure_rate is None or finished < t.min_sample or s.failure_rate < t.failure_rate:
            continue
        top = f' Most common: "{s.errors[0].name}" ({s.errors[0].count}x).' if s.errors else ""
        yield Insight(
            severity=Severity.HIGH if s.failure_rate >= t.failure_rate_high else Severity.MEDIUM,
            area=InsightArea.RELIABILITY,
            subject=s.skill,
            title=f"{s.skill} fails {pct(s.failure_rate)} of its jobs",
            detail=f"{s.jobs.failed} of {finished} finished jobs failed.{top} Failed jobs "
            "still spend CLI runs against the ceiling; fix the cause before re-running.",
            metric="failure_rate", value=s.failure_rate, threshold=t.failure_rate,
        )  # fmt: skip


def schema_retries(ctx: Context) -> Iterable[Insight]:
    t = ctx.limits
    for s in ctx.skills:
        rate = s.schema_retry_rate
        if rate is None or s.artifacts < t.min_sample or rate < t.schema_retry_rate:
            continue
        yield Insight(
            severity=Severity.MEDIUM,
            area=InsightArea.QUALITY,
            subject=s.skill,
            title=f"{s.skill} needs a second try {pct(rate)} of the time",
            detail="The first reply broke the schema or cited unknown anchors, so the run "
            "was paid twice. Tighten the output section of SKILL.md: one complete example "
            "of the exact JSON, and the rules the retry keeps quoting.",
            metric="schema_retry_rate", value=rate, threshold=t.schema_retry_rate,
        )  # fmt: skip


def repairs(ctx: Context) -> Iterable[Insight]:
    t = ctx.limits
    for s in ctx.skills:
        rate = s.repair_rate
        if rate is None or s.artifacts < t.min_sample or rate < t.repair_rate:
            continue
        yield Insight(
            severity=Severity.INFO,
            area=InsightArea.QUALITY,
            subject=s.skill,
            title=f"{s.skill} output is mended by the repair pass {pct(rate)} of the time",
            detail="The model keeps drifting from the render-block shape in the same ways. "
            "Teaching SKILL.md the shape costs nothing per run; relying on repair hides "
            "the drift until a case it cannot mend.",
            metric="repair_rate", value=rate, threshold=t.repair_rate,
        )  # fmt: skip


def flagged(ctx: Context) -> Iterable[Insight]:
    t = ctx.limits
    for s in ctx.skills:
        rate = s.needs_review_rate
        if rate is None or s.artifacts < t.min_sample or rate < t.flagged_rate:
            continue
        top = ", ".join(f"{f.name} ({f.count})" for f in s.flags[:3])
        yield Insight(
            severity=Severity.MEDIUM,
            area=InsightArea.QUALITY,
            subject=s.skill,
            title=f"{pct(rate)} of {s.skill} outputs trip a gate",
            detail=f"Each one waits for review. Flags: {top or 'none recorded'}. A flag "
            "that dominates points at one rule in the prompt, or a gate band to revisit.",
            metric="flagged_rate", value=rate, threshold=t.flagged_rate,
        )  # fmt: skip


def weak_grounding(ctx: Context) -> Iterable[Insight]:
    t = ctx.limits
    for s in ctx.skills:
        g = s.grounding_mean
        if g is None or s.artifacts < t.min_sample or g >= t.grounding_floor:
            continue
        yield Insight(
            severity=Severity.HIGH,
            area=InsightArea.QUALITY,
            subject=s.skill,
            title=f"{s.skill} grounds only {pct(g)} of its spans on average",
            detail="Uncited spans are claims nobody can check (D6). Look at which inputs "
            "the selector passes: a span cannot cite a block the prompt never showed.",
            metric="grounding_mean", value=g, threshold=t.grounding_floor,
        )  # fmt: skip


def tier_down(ctx: Context) -> Iterable[Insight]:
    t = ctx.limits
    for s in ctx.skills:
        if not ({"distil", "reason"} & set(s.tiers)) or s.artifacts < t.tier_down_sample:
            continue
        rates = (s.needs_review_rate, s.schema_retry_rate, s.failure_rate)
        clean = all(r is not None and r <= t.tier_down_rates for r in rates)
        if not clean or s.grounding_mean is None or s.grounding_mean < t.tier_down_grounding:
            continue
        yield Insight(
            severity=Severity.INFO,
            area=InsightArea.COST,
            subject=s.skill,
            title=f"{s.skill} may hold up one tier cheaper",
            detail=f"Grounding {pct(s.grounding_mean)} with almost no flags, retries or "
            f"failures on {'/'.join(s.tiers)}. Try one book on the rung below "
            "(BOOKSHELF_MODEL_*) and compare these figures (D16).",
            metric="grounding_mean", value=s.grounding_mean, threshold=t.tier_down_grounding,
        )  # fmt: skip


def slow_tail(ctx: Context) -> Iterable[Insight]:
    t = ctx.limits
    for s in ctx.skills:
        d = s.duration
        if d.count < t.min_sample or d.p50_ms is None or d.p95_ms is None or d.max_ms is None:
            continue
        if d.max_ms >= t.timeout_share * ctx.timeout_ms:
            yield Insight(
                severity=Severity.HIGH,
                area=InsightArea.RELIABILITY,
                subject=s.skill,
                title=f"{s.skill} runs come close to the CLI timeout",
                detail=f"The slowest took {minutes(d.max_ms)} against a "
                f"{minutes(ctx.timeout_ms)} timeout. Split its input (smaller scopes), "
                "lower its effort, or raise BOOKSHELF_CLAUDE_TIMEOUT_SECONDS.",
                metric="max_ms", value=d.max_ms, threshold=t.timeout_share * ctx.timeout_ms,
            )  # fmt: skip
        elif d.p95_ms >= t.tail_factor * d.p50_ms and d.p95_ms >= t.tail_min_ms:
            yield Insight(
                severity=Severity.MEDIUM,
                area=InsightArea.SPEED,
                subject=s.skill,
                title=f"{s.skill} has a long tail: p95 is {d.p95_ms / d.p50_ms:.1f}x the median",
                detail=f"Median {minutes(d.p50_ms)}, p95 {minutes(d.p95_ms)}. The slow "
                "scopes are usually the largest inputs; check the chapter table.",
                metric="p95_over_p50", value=round(d.p95_ms / d.p50_ms, 2),
                threshold=t.tail_factor,
            )  # fmt: skip


def cost_drivers(ctx: Context) -> Iterable[Insight]:
    t = ctx.limits
    total = sum(s.tokens.tokens for s in ctx.skills)
    if total <= 0 or len(ctx.skills) < 2:
        return
    for s in ctx.skills:
        share = s.tokens.tokens / total
        if share < t.cost_driver_share:
            continue
        per_word = (
            f", {s.tokens_per_output_word:.0f} tokens per word written"
            if s.tokens_per_output_word
            else ""
        )
        yield Insight(
            severity=Severity.INFO,
            area=InsightArea.COST,
            subject=s.skill,
            title=f"{s.skill} spends {pct(share)} of all tokens",
            detail=f"{s.tokens.tokens:,} tokens over {s.jobs.done} done jobs{per_word}. "
            "The biggest lever on cost: trim what its selector sends (mean prompt "
            f"{s.prompt_chars_mean or 0:,.0f} chars) before tuning anything else.",
            metric="token_share", value=round(share, 3), threshold=t.cost_driver_share,
        )  # fmt: skip

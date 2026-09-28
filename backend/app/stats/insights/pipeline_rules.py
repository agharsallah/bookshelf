"""Rules about the pipeline as a whole: waste, throughput, outlier chapters and books,
and the telemetry itself."""

from collections.abc import Iterable, Sequence

from app.schemas.stats import Insight, InsightArea, Severity
from app.stats.insights.context import Context, minutes, pct
from app.stats.numbers import percentile


def waste(ctx: Context) -> Iterable[Insight]:
    t = ctx.limits
    wasted, tracked = (
        ctx.tokens.wasted_tokens,
        (ctx.tokens.input_tokens or 0) + (ctx.tokens.output_tokens or 0),
    )
    if not wasted or not tracked or wasted / tracked < t.waste_share:
        return
    share = wasted / tracked
    yield Insight(
        severity=Severity.MEDIUM,
        area=InsightArea.COST,
        subject=ctx.subject,
        title=f"{pct(share)} of tracked tokens went to attempts that produced nothing",
        detail=f"{wasted:,} tokens were spent by failed jobs and by attempts a retry "
        "redid. The reliability insights say which skills they came from.",
        metric="wasted_share", value=round(share, 3), threshold=t.waste_share,
    )  # fmt: skip


def throughput(ctx: Context) -> Iterable[Insight]:
    t, time = ctx.limits, ctx.time
    if (
        ctx.concurrency > 1
        and time.parallelism is not None
        and time.active_ms >= t.parallelism_min_active_ms
        and time.parallelism < t.parallelism_floor
    ):
        yield Insight(
            severity=Severity.MEDIUM,
            area=InsightArea.THROUGHPUT,
            subject=ctx.subject,
            title=f"The pipeline ran at {time.parallelism:.1f}x with {ctx.concurrency} slots",
            detail="Most of the time only one job was running. Stage barriers (element "
            "jobs before section notes, notes before chapters) serialize a book; a book "
            "with few chapters has little to run side by side.",
            metric="parallelism", value=time.parallelism, threshold=t.parallelism_floor,
        )  # fmt: skip
    p50 = time.wait.p50_ms
    if p50 is not None and p50 >= t.wait_p50_ms:
        yield Insight(
            severity=Severity.INFO,
            area=InsightArea.THROUGHPUT,
            subject=ctx.subject,
            title=f"Jobs waited {minutes(p50)} (median) before starting",
            detail="Queue time, not model time: more worker slots or a second worker "
            "(BOOKSHELF_WORKER_CONCURRENCY) shortens the wall clock without touching a skill.",
            metric="wait_p50_ms", value=p50, threshold=t.wait_p50_ms,
        )  # fmt: skip


def _outliers(
    values: Sequence[tuple[str, float | None]], factor: float, minimum: int, limit: int
) -> list[tuple[str, float, float]]:
    known = [(name, v) for name, v in values if v is not None and v > 0]
    if len(known) < minimum:
        return []
    median = percentile([v for _, v in known], 50) or 0
    high = sorted(((n, v) for n, v in known if median and v >= factor * median),
                  key=lambda nv: -nv[1])  # fmt: skip
    return [(n, v, median) for n, v in high[:limit]]


def chapter_outliers(ctx: Context) -> Iterable[Insight]:
    t = ctx.limits
    titles = {c.anchor: c.title or c.anchor for c in ctx.chapters}
    cost = [(c.anchor, c.tokens_per_1k_words) for c in ctx.chapters]
    for anchor, value, median in _outliers(cost, t.outlier_factor, t.outlier_min_units,
                                           t.outlier_limit):  # fmt: skip
        yield Insight(
            severity=Severity.INFO,
            area=InsightArea.COST,
            subject=anchor,
            title=f"{titles[anchor]} costs {value / median:.1f}x the median per word",
            detail=f"{value:,.0f} tokens per 1k words against a median of {median:,.0f}. "
            "Often a mis-split chapter (check the outline), many figures, or a section "
            "that retried.",
            metric="tokens_per_1k_words", value=value, threshold=t.outlier_factor * median,
        )  # fmt: skip
    speed = [(c.anchor, c.seconds_per_page) for c in ctx.chapters]
    for anchor, value, median in _outliers(speed, t.outlier_factor, t.outlier_min_units,
                                           t.outlier_limit):  # fmt: skip
        yield Insight(
            severity=Severity.INFO,
            area=InsightArea.SPEED,
            subject=anchor,
            title=f"{titles[anchor]} takes {value / median:.1f}x the median time per page",
            detail=f"{value:,.0f} s of compute per page against a median of {median:,.0f} s.",
            metric="seconds_per_page", value=value, threshold=t.outlier_factor * median,
        )  # fmt: skip


def book_outliers(ctx: Context) -> Iterable[Insight]:
    t = ctx.limits
    titles = {b.book.slug: b.book.title for b in ctx.books}
    cost = [(b.book.slug, b.efficiency.tokens_per_1k_words) for b in ctx.books]
    for slug, value, median in _outliers(cost, t.outlier_factor, 3, t.outlier_limit):
        yield Insight(
            severity=Severity.INFO,
            area=InsightArea.COST,
            subject=slug,
            title=f"{titles[slug]} costs {value / median:.1f}x the library median per word",
            detail=f"{value:,.0f} tokens per 1k words against {median:,.0f}. Its own stats "
            "page shows which chapters and skills account for it.",
            metric="tokens_per_1k_words", value=value, threshold=t.outlier_factor * median,
        )  # fmt: skip


def telemetry_gap(ctx: Context) -> Iterable[Insight]:
    if ctx.tokens.tracked_calls == 0 and ctx.tokens.tokens > 0:
        yield Insight(
            severity=Severity.INFO,
            area=InsightArea.TELEMETRY,
            subject=ctx.subject,
            title="Cache, cost and waste figures start with the next runs",
            detail="These jobs ran before per-call telemetry (model_runs). Tokens and "
            "times come from the job rows; re-run a stage to see the full breakdown.",
            metric="tracked_calls", value=0,
        )  # fmt: skip

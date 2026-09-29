"""Assemble `DocumentStats` (one book, in depth) and `LibraryStats` (every book, side by
side) from the facts `collect` loads. The one place statistics touch settings and skills."""

from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import text
from sqlmodel import Session, col, select

from app.core.config import Settings
from app.models import Document
from app.models.enums import JobKind
from app.pipeline.skills import load_catalogue
from app.schemas.stats import (
    BookInfo,
    BookRow,
    DocumentStats,
    Efficiency,
    LibraryStats,
    TimeTotals,
    TokenTotals,
)
from app.stats import activity, chapters, collect, skills, timeline
from app.stats.facts import BookFacts, CallFact
from app.stats.insights import Context, insights
from app.stats.numbers import rate, ratio, rounded
from app.stats.tokens import job_counts, token_totals

_KIND_MEDIANS = text(
    """
    select kind, percentile_cont(0.5) within group (order by duration_ms)
    from jobs where state = 'done' and duration_ms is not null group by kind
    """
)


def kind_skills(skills_dir: Path) -> dict[JobKind, str]:
    """Which skill runs each stage, from the packages' `meta.yaml` (`derive` names its own)."""
    return {
        skill.meta.job_kind: skill.name
        for skill in load_catalogue(skills_dir).values()
        if skill.meta.job_kind is not None and skill.meta.job_kind is not JobKind.DERIVE
    }


def kind_medians(session: Session) -> dict[JobKind, float]:
    """Median run time per kind across the library: the ETA's per-job estimate."""
    return {JobKind(k): float(v) for k, v in session.execute(_KIND_MEDIANS).all() if v}


def book_info(facts: BookFacts) -> BookInfo:
    d, shape = facts.document, facts.shape
    return BookInfo(
        id=str(d.id),
        slug=d.slug,
        title=d.title,
        authors=list(d.authors),
        year=d.year,
        kind=d.kind,
        status=d.status,
        language=d.language,
        parse_tier=d.parse_tier,
        pages=d.page_count,
        chapters=sum(1 for c in facts.chapters if not c.skipped),
        sections=shape.sections,
        blocks=shape.blocks,
        words=shape.words,
        elements=dict(shape.elements),
        created_at=d.created_at,
    )


def efficiency(info: BookInfo, tokens: TokenTotals, time: TimeTotals) -> Efficiency:
    """Cost and time normalized by the book's size, so books of any length compare."""
    seconds = time.compute_ms / 1000
    return Efficiency(
        tokens_per_page=rounded(ratio(tokens.tokens, info.pages), 1),
        tokens_per_1k_words=rounded(ratio(tokens.tokens, info.words / 1000), 1),
        seconds_per_page=rounded(ratio(seconds, info.pages), 1),
        minutes_per_10k_words=rounded(ratio(seconds / 60, info.words / 10_000), 2),
        cost_per_page_usd=rounded(ratio(tokens.cost_usd, info.pages), 4),
    )


def _telemetry_since(calls: Sequence[CallFact]) -> datetime | None:
    return min((c.created_at for c in calls), default=None)


def _load(session: Session, documents: Sequence[Document]) -> list[BookFacts]:
    return collect.load_books(session, documents)


def document_stats(
    session: Session, document: Document, *, settings: Settings, skills_dir: Path
) -> DocumentStats:
    [facts] = _load(session, [document])
    jobs, calls, artifacts = facts.jobs, facts.calls, facts.artifacts
    info = book_info(facts)
    tokens = token_totals(jobs, calls)
    time = timeline.time_totals(jobs, calls)
    skill_rows = skills.all_skill_stats(jobs, calls, artifacts, kind_skills(skills_dir))
    chapter_rows = chapters.chapter_stats(facts.chapters, jobs, calls, artifacts)
    all_passes = timeline.passes(jobs, calls)
    context = Context(
        subject=document.slug,
        skills=skill_rows,
        tokens=tokens,
        time=time,
        concurrency=settings.worker_concurrency,
        timeout_ms=settings.claude_timeout_seconds * 1000,
        chapters=chapter_rows,
    )
    return DocumentStats(
        book=info,
        jobs=job_counts(jobs),
        tokens=tokens,
        time=time,
        efficiency=efficiency(info, tokens, time),
        end_to_end=timeline.end_to_end(all_passes),
        passes=all_passes,
        stages=timeline.stage_spans(jobs, calls),
        chapters=chapter_rows,
        skills=skill_rows,
        models=skills.model_stats(jobs, calls),
        remaining=timeline.remaining(jobs, settings.worker_concurrency, kind_medians(session)),
        insights=insights(context),
        telemetry_since=_telemetry_since(calls),
        generated_at=datetime.now(UTC),
    )


def _book_row(facts: BookFacts, slots: int, medians: dict[JobKind, float]) -> BookRow:
    info = book_info(facts)
    tokens = token_totals(facts.jobs, facts.calls)
    time = timeline.time_totals(facts.jobs, facts.calls)
    first = timeline.end_to_end(timeline.passes(facts.jobs, facts.calls))
    counts = job_counts(facts.jobs)
    finished = [j.finished_at for j in facts.jobs if j.finished_at is not None]
    return BookRow(
        book=info,
        jobs=counts,
        tokens=tokens,
        time=time,
        efficiency=efficiency(info, tokens, time),
        end_to_end_ms=first.wall_ms if first else None,
        failure_rate=rounded(rate(counts.failed, counts.done + counts.failed)),
        remaining=timeline.remaining(facts.jobs, slots, medians),
        last_activity=max(finished, default=None),
    )


def library_stats(session: Session, *, settings: Settings, skills_dir: Path) -> LibraryStats:
    documents = list(session.exec(select(Document).order_by(col(Document.created_at))))
    books = _load(session, documents)
    jobs = [j for b in books for j in b.jobs]
    calls = [c for b in books for c in b.calls]
    artifacts = [a for b in books for a in b.artifacts]
    medians = kind_medians(session)
    rows = [_book_row(b, settings.worker_concurrency, medians) for b in books]
    tokens = token_totals(jobs, calls)
    time = timeline.time_totals(jobs, calls)
    skill_rows = skills.all_skill_stats(jobs, calls, artifacts, kind_skills(skills_dir))
    context = Context(
        subject="library",
        skills=skill_rows,
        tokens=tokens,
        time=time,
        concurrency=settings.worker_concurrency,
        timeout_ms=settings.claude_timeout_seconds * 1000,
        books=rows,
    )
    return LibraryStats(
        books=sorted(rows, key=lambda r: r.last_activity or r.book.created_at, reverse=True),
        jobs=job_counts(jobs),
        tokens=tokens,
        time=time,
        skills=skill_rows,
        models=skills.model_stats(jobs, calls),
        stages=timeline.stage_spans(jobs, calls),
        activity=activity.daily(jobs, calls),
        insights=insights(context),
        telemetry_since=_telemetry_since(calls),
        generated_at=datetime.now(UTC),
    )

"""Rules about books and chapters: what stalled, what is nearly done, where you slowed down."""

from collections.abc import Iterable

from app.reader_stats.facts import FINISHED
from app.reader_stats.insights.context import Context, pct, read_href
from app.schemas.reader_stats import BookState, InsightTopic, ReaderInsight, Tone


def _book_href(slug: str) -> str:
    return f"/documents/{slug}"


def stalled(ctx: Context) -> Iterable[ReaderInsight]:
    for book in ctx.books:
        if book.state is not BookState.STALLED or book.last_seen is None:
            continue
        days = ctx.clock.days_ago(book.last_seen)
        yield ReaderInsight(
            tone=Tone.ATTENTION, topic=InsightTopic.PROGRESS,
            title=f"{book.title} has waited {days} days at {pct(book.progress)}",
            detail="Pick it up where you left off, or recall the last chapter you read to "
            "find the thread again.",
            href=_book_href(book.slug), metric="days_since_seen", value=days,
        )  # fmt: skip


def almost_done(ctx: Context) -> Iterable[ReaderInsight]:
    for book in ctx.books:
        if book.state is BookState.READING and book.progress >= ctx.limits.almost_done:
            left = book.chapters - book.chapters_finished
            yield ReaderInsight(
                tone=Tone.POSITIVE, topic=InsightTopic.PROGRESS,
                title=f"{left} {'chapter' if left == 1 else 'chapters'} left in {book.title}",
                detail=f"You are {pct(book.progress)} of the way through.",
                href=_book_href(book.slug), metric="progress", value=book.progress,
            )  # fmt: skip


def finished(ctx: Context) -> Iterable[ReaderInsight]:
    done = [b for b in ctx.books if b.state is BookState.FINISHED]
    if done and ctx.book is None:
        yield ReaderInsight(
            tone=Tone.POSITIVE, topic=InsightTopic.PROGRESS,
            title=f"{len(done)} {'book' if len(done) == 1 else 'books'} finished",
            detail=", ".join(b.title for b in done[:4]) + (" and more." if len(done) > 4 else "."),
            metric="books_finished", value=len(done),
        )  # fmt: skip


def open_books(ctx: Context) -> Iterable[ReaderInsight]:
    reading = [b for b in ctx.books if b.state is BookState.READING]
    if len(reading) >= ctx.limits.many_open_books:
        yield ReaderInsight(
            tone=Tone.NEUTRAL, topic=InsightTopic.FOCUS,
            title=f"{len(reading)} books are open at once",
            detail="Switching books costs context. Finishing one first usually makes the "
            "others go faster.",
            metric="books_reading", value=len(reading),
        )  # fmt: skip


def slow_chapters(ctx: Context) -> Iterable[ReaderInsight]:
    t = ctx.limits
    slow = sorted(
        (c for c in ctx.chapters if c.pace and c.pace >= t.slow_pace), key=lambda c: -(c.pace or 0)
    )
    for c in slow[: t.chapter_limit]:
        yield ReaderInsight(
            tone=Tone.NEUTRAL, topic=InsightTopic.FOCUS,
            title=f"{c.title} took {c.pace:.1f}x your usual time per word",
            detail=f"{c.book_title}. Dense chapters are where a distillation, a note or a "
            "recall pays off most.",
            href=read_href(c.document, c.anchor), metric="pace", value=c.pace or 0,
        )  # fmt: skip


def fast_chapters(ctx: Context) -> Iterable[ReaderInsight]:
    t = ctx.limits
    fast = [c for c in ctx.chapters if c.pace and c.pace <= t.fast_pace and c.progress >= FINISHED]
    for c in sorted(fast, key=lambda c: c.pace or 0)[: t.chapter_limit]:
        yield ReaderInsight(
            tone=Tone.NEUTRAL, topic=InsightTopic.FOCUS,
            title=f"You went through {c.title} at {1 / (c.pace or 1):.1f}x your usual speed",
            detail=f"{c.book_title}. Skimmed on purpose? A recall tells you whether it stuck.",
            href=read_href(c.document, c.anchor), metric="pace", value=c.pace or 0,
        )  # fmt: skip


def revisited(ctx: Context) -> Iterable[ReaderInsight]:
    top = next((p for p in ctx.passages if p.visits >= ctx.limits.revisits), None)
    if top:
        yield ReaderInsight(
            tone=Tone.NEUTRAL, topic=InsightTopic.FOCUS,
            title=f"You came back to one passage on {top.visits} days",
            detail=f"In {top.chapter} ({top.book_title}): “{top.text[:120]}…”. If it keeps "
            "pulling you back, a note would say why.",
            href=read_href(top.document, top.anchor), metric="visits", value=top.visits,
        )  # fmt: skip

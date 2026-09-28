"""Rules about what you keep: notes, recalls, predictions and spaced reviews."""

from collections.abc import Iterable

from app.reader_stats.insights.context import Context, pct
from app.schemas.reader_stats import InsightTopic, ReaderInsight, Tone


def unannotated(ctx: Context) -> Iterable[ReaderInsight]:
    n = ctx.notes.chapters_without_notes
    if n >= ctx.limits.unannotated_chapters:
        yield ReaderInsight(
            tone=Tone.ATTENTION, topic=InsightTopic.NOTES,
            title=f"{n} finished chapters have no note or highlight",
            detail="A line in your own words per chapter is what makes it findable later.",
            metric="chapters_without_notes", value=n,
        )  # fmt: skip


def highlight_heavy(ctx: Context) -> Iterable[ReaderInsight]:
    t, notes = ctx.limits, ctx.notes
    if (
        notes.highlights >= t.min_highlights
        and notes.notes / notes.highlights < t.note_to_highlight
    ):
        yield ReaderInsight(
            tone=Tone.NEUTRAL, topic=InsightTopic.NOTES,
            title=f"{notes.highlights} highlights, {notes.notes} notes",
            detail="Highlights mark what; a few words say why. The why is what you will "
            "search for.",
            metric="notes_per_highlight", value=round(notes.notes / notes.highlights, 3),
        )  # fmt: skip


def densest_book(ctx: Context) -> Iterable[ReaderInsight]:
    dense = [b for b in ctx.books if b.notes_per_1k_words]
    if ctx.book is None and len(dense) >= 2:
        top = max(dense, key=lambda b: b.notes_per_1k_words or 0)
        yield ReaderInsight(
            tone=Tone.POSITIVE, topic=InsightTopic.NOTES,
            title=f"{top.title} is the book you annotate most",
            detail=f"{top.notes_per_1k_words:.1f} notes and highlights per 1,000 words read.",
            href=f"/documents/{top.slug}", metric="notes_per_1k_words",
            value=top.notes_per_1k_words or 0,
        )  # fmt: skip


def unrecalled(ctx: Context) -> Iterable[ReaderInsight]:
    finished = ctx.totals.chapters_finished
    if finished >= ctx.limits.unrecalled_chapters and ctx.memory.recalls == 0:
        yield ReaderInsight(
            tone=Tone.ATTENTION, topic=InsightTopic.MEMORY,
            title=f"{finished} chapters finished, none recalled",
            detail="Writing a chapter from memory, book closed, is the strongest way to keep "
            "it. The reader's Recall button grades it against the chapter's key ideas.",
            metric="recalls", value=0,
        )  # fmt: skip


def missed_ideas(ctx: Context) -> Iterable[ReaderInsight]:
    ideas = {c.key: c.count for c in ctx.memory.ideas}
    total = sum(ideas.values())
    missed = ideas.get("missed", 0)
    if total and missed / total >= ctx.limits.missed_share:
        yield ReaderInsight(
            tone=Tone.ATTENTION, topic=InsightTopic.MEMORY,
            title=f"Recalls miss {pct(missed / total)} of key ideas",
            detail="The missed ideas are already in your review queue; reviewing them the "
            "day they are due is what moves this number.",
            href="/", metric="missed_share", value=round(missed / total, 3),
        )  # fmt: skip


def recall_trend(ctx: Context) -> Iterable[ReaderInsight]:
    trend = ctx.memory.trend
    if len(trend) >= 2 * ctx.limits.min_recalls:
        k = ctx.limits.min_recalls
        first = sum(p.score for p in trend[:k]) / k
        last = sum(p.score for p in trend[-k:]) / k
        if abs(last - first) >= 0.1:
            better = last > first
            yield ReaderInsight(
                tone=Tone.POSITIVE if better else Tone.ATTENTION, topic=InsightTopic.MEMORY,
                title=f"Recall scores went from {pct(first)} to {pct(last)}",
                detail="Your latest recalls against your first ones."
                + ("" if better else " Try a prediction before reading the next chapter."),
                metric="recall_score_change", value=round(last - first, 3),
            )  # fmt: skip


def no_predictions(ctx: Context) -> Iterable[ReaderInsight]:
    m = ctx.memory
    if m.recalls >= ctx.limits.min_recalls and m.predictions == 0:
        yield ReaderInsight(
            tone=Tone.NEUTRAL, topic=InsightTopic.MEMORY,
            title="You have not predicted a chapter yet",
            detail="Guessing what a chapter will argue before reading it primes what to "
            "look for, and the grade compares it with your recall.",
            metric="predictions", value=0,
        )  # fmt: skip


def due_backlog(ctx: Context) -> Iterable[ReaderInsight]:
    due = ctx.memory.due_now
    if due >= ctx.limits.due_backlog:
        yield ReaderInsight(
            tone=Tone.ATTENTION, topic=InsightTopic.MEMORY,
            title=f"{due} reviews are due",
            detail="Spaced reviews work on the day they are due; a backlog turns into "
            "relearning.",
            href="/", metric="due_now", value=due,
        )  # fmt: skip


def retention(ctx: Context) -> Iterable[ReaderInsight]:
    m, t = ctx.memory, ctx.limits
    if m.reviews >= t.min_reviews and m.retention is not None:
        good = m.retention >= t.retention_floor
        yield ReaderInsight(
            tone=Tone.POSITIVE if good else Tone.ATTENTION, topic=InsightTopic.MEMORY,
            title=f"You remember {pct(m.retention)} of what you review",
            detail="Reviews not rated Again." + ("" if good else " Below 80%, cards come back "
            "too soon to stick: answer before revealing, in your own words."),
            metric="retention", value=m.retention,
        )  # fmt: skip

"""Your notes: how many, how long, in which colors, on what, and where there are none."""

from collections import Counter
from collections.abc import Sequence

from app.reader_stats.facts import FINISHED, Facts
from app.reader_stats.numbers import bins, rounded
from app.schemas.reader_stats import ChapterRow, Count, NoteStats

LENGTH_BINS = (
    ("1-10", 1), ("11-25", 11), ("26-50", 26), ("51-100", 51), ("101-250", 101), ("250 +", 251),
)  # fmt: skip


def counts(values: Sequence[str]) -> list[Count]:
    """Most common first, then by key."""
    return [
        Count(key=k, count=n)
        for k, n in sorted(Counter(values).items(), key=lambda kv: (-kv[1], kv[0]))
    ]


def note_stats(facts: Facts, chapters: Sequence[ChapterRow]) -> NoteStats:
    written = [n for n in facts.notes if not n.highlight]
    words = sum(n.words for n in written)
    return NoteStats(
        notes=len(written),
        highlights=len(facts.notes) - len(written),
        words=words,
        mean_words=rounded(words / len(written), 1) if written else None,
        by_color=counts([n.color or "none" for n in facts.notes]),
        by_target=counts([n.target for n in facts.notes]),
        length=bins((n.words for n in written), LENGTH_BINS) if written else [],
        chapters_without_notes=sum(
            1 for c in chapters if c.progress >= FINISHED and c.notes + c.highlights == 0
        ),
    )

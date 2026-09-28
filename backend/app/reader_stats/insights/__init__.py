"""Rules that read the reader statistics and say something about you: habits, progress,
focus, notes and memory.

Each rule is a plain function `(Context) -> Iterable[ReaderInsight]`, listed in `RULES`;
adding one is adding a function. Thresholds live in `Thresholds`. Insights that ask for
attention come first, then praise, then observations (rule order breaks ties).
"""

from collections.abc import Sequence

from app.reader_stats.insights.context import Context, Rule, Thresholds
from app.reader_stats.insights.habit import (
    best_weekday,
    listening,
    peak_hours,
    short_sittings,
    streak,
    tracking_started,
)
from app.reader_stats.insights.learning import (
    densest_book,
    due_backlog,
    highlight_heavy,
    missed_ideas,
    no_predictions,
    recall_trend,
    retention,
    unannotated,
    unrecalled,
)
from app.reader_stats.insights.progress import (
    almost_done,
    fast_chapters,
    finished,
    open_books,
    revisited,
    slow_chapters,
    stalled,
)
from app.schemas.reader_stats import ReaderInsight, Tone

RULES: tuple[Rule, ...] = (
    due_backlog,
    stalled,
    unrecalled,
    missed_ideas,
    retention,
    unannotated,
    streak,
    almost_done,
    finished,
    recall_trend,
    densest_book,
    peak_hours,
    best_weekday,
    short_sittings,
    listening,
    slow_chapters,
    fast_chapters,
    revisited,
    open_books,
    highlight_heavy,
    no_predictions,
    tracking_started,
)

_RANK = {Tone.ATTENTION: 0, Tone.POSITIVE: 1, Tone.NEUTRAL: 2}


def insights(ctx: Context, rules: Sequence[Rule] = RULES) -> list[ReaderInsight]:
    found = [(i, insight) for i, rule in enumerate(rules) for insight in rule(ctx)]
    return [insight for _, insight in sorted(found, key=lambda p: (_RANK[p[1].tone], p[0]))]


__all__ = ["RULES", "Context", "Rule", "Thresholds", "insights"]

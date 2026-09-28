"""Numeric helpers for reader statistics: shares, medians, histograms and word counts."""

from collections.abc import Iterable, Sequence

from app.schemas.reader_stats import HistogramBin
from app.stats.numbers import mean, percentile, rate, ratio, rounded

__all__ = ["bins", "mean", "median", "percentile", "rate", "ratio", "rounded", "share"]


def median(values: Sequence[float]) -> float | None:
    return percentile(values, 50)


def share(part: float, whole: float) -> float:
    return part / whole if whole else 0.0


def bins(values: Iterable[int], edges: Sequence[tuple[str, int]]) -> list[HistogramBin]:
    """Count `values` into bins starting at each edge; the last bin is open-ended.

    `edges` are (label, lower bound) in ascending order; a value below the first bound
    is counted in the first bin.
    """
    counts = [0] * len(edges)
    for value in values:
        index = 0
        for i, (_, low) in enumerate(edges):
            if value >= low:
                index = i
        counts[index] += 1
    return [
        HistogramBin(
            label=label,
            low=low,
            high=edges[i + 1][1] if i + 1 < len(edges) else None,
            count=counts[i],
        )
        for i, (label, low) in enumerate(edges)
    ]

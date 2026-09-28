"""Small numeric helpers shared by every statistic: nothing here knows about jobs."""

import math
from collections.abc import Iterable, Sequence

from app.schemas.stats import DurationStats


def percentile(values: Sequence[float], q: float) -> float | None:
    """The `q`-th percentile (0-100), linear between closest ranks; None when empty."""
    if not values:
        return None
    ordered = sorted(values)
    rank = (len(ordered) - 1) * q / 100
    low, high = math.floor(rank), math.ceil(rank)
    return ordered[low] + (ordered[high] - ordered[low]) * (rank - low)


def mean(values: Sequence[float]) -> float | None:
    return sum(values) / len(values) if values else None


def ratio(numerator: float | None, denominator: float | None) -> float | None:
    """`numerator / denominator`, or None when either is missing or the divisor is 0."""
    if numerator is None or not denominator:
        return None
    return numerator / denominator


def rate(hits: int, total: int) -> float | None:
    """A share in [0, 1]; None when there is nothing to take a share of."""
    return hits / total if total else None


def rounded(value: float | None, digits: int = 3) -> float | None:
    return round(value, digits) if value is not None else None


def _ms(value: float | None) -> int | None:
    return round(value) if value is not None else None


def durations(values: Iterable[int | None]) -> DurationStats:
    known = [v for v in values if v is not None]
    if not known:
        return DurationStats()
    return DurationStats(
        count=len(known),
        total_ms=sum(known),
        mean_ms=_ms(mean(known)),
        p50_ms=_ms(percentile(known, 50)),
        p95_ms=_ms(percentile(known, 95)),
        max_ms=max(known),
    )

"""Axis-aligned box arithmetic on plain `(x0, y0, x1, y1)` tuples."""

from collections.abc import Iterable

from app.pipeline.parse.model import Bbox


def union(boxes: Iterable[Bbox]) -> Bbox:
    xs0, ys0, xs1, ys1 = zip(*boxes, strict=True)
    return min(xs0), min(ys0), max(xs1), max(ys1)


def pad(box: Bbox, by: float) -> Bbox:
    return box[0] - by, box[1] - by, box[2] + by, box[3] + by


def intersects(a: Bbox, b: Bbox) -> bool:
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def contains(outer: Bbox, inner: Bbox) -> bool:
    return (
        outer[0] <= inner[0] and outer[1] <= inner[1] and inner[2] <= outer[2]
        and inner[3] <= outer[3]
    )  # fmt: skip


def center_in(inner: Bbox, outer: Bbox, tolerance: float = 2.0) -> bool:
    cx, cy = (inner[0] + inner[2]) / 2, (inner[1] + inner[3]) / 2
    x0, y0, x1, y1 = pad(outer, tolerance)
    return x0 <= cx <= x1 and y0 <= cy <= y1


def clip(box: Bbox, to: Bbox) -> Bbox:
    return max(box[0], to[0]), max(box[1], to[1]), min(box[2], to[2]), min(box[3], to[3])


def area(box: Bbox) -> float:
    return max(0.0, box[2] - box[0]) * max(0.0, box[3] - box[1])


def rounded(box: Iterable[float]) -> Bbox:
    x0, y0, x1, y1 = (round(float(v), 1) for v in box)
    return x0, y0, x1, y1

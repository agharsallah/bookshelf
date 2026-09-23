"""Text lines and blocks with the typography the classifiers need, plus reading order.

`extract_blocks()` turns one page's `get_text("dict")` into `Block`s (MuPDF's blocks,
split further wherever the typography changes). `reading_order()` sorts a page's items by
column, not by y-coordinate, so two-column pages read left column first (§8).
"""

import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from functools import cached_property
from typing import Any

import pymupdf

from app.pipeline.parse.model import Bbox
from app.pipeline.parse.pdf import mupdf
from app.pipeline.parse.text import (
    FIGURE_CAPTION,
    LISTING_CAPTION,
    TABLE_CAPTION,
    join_lines,
    list_marker,
)

_MATH_FONT = re.compile(
    r"cmmi|cmsy|cmex|msam|msbm|stix|cambria\s*math|math|xits|lmmath|mtmi|mtsy|rsfs|eufm",
    re.IGNORECASE,
)
_MONO_FONT = re.compile(
    r"courier|mono|consol|menlo|inconsolata|typewriter|cmtt|lmtt|sourcecode", re.IGNORECASE
)
_MARKER = re.compile(r"^\s*(\d{1,3}|[*\u2020\u2021\u00a7\u00b6])\s*$")
_CAPTIONS = (FIGURE_CAPTION, TABLE_CAPTION, LISTING_CAPTION)


@dataclass(slots=True)
class Line:
    page: int  # 1-based
    bbox: Bbox
    text: str
    size: float
    bold: bool = False
    italic: bool = False
    mono: bool = False
    math_chars: int = 0
    sup_markers: list[str] = field(default_factory=list)


@dataclass
class Block:
    """Consecutive lines that read as one unit. `column` is set by `reading_order()`."""

    page: int
    lines: list[Line]
    column: tuple[float, float] = (0.0, 0.0)

    @cached_property
    def bbox(self) -> Bbox:
        return (
            min(line.bbox[0] for line in self.lines),
            min(line.bbox[1] for line in self.lines),
            max(line.bbox[2] for line in self.lines),
            max(line.bbox[3] for line in self.lines),
        )

    @cached_property
    def text(self) -> str:
        return join_lines([line.text for line in self.lines])

    @cached_property
    def size(self) -> float:
        """Character-weighted font size."""
        total = sum(len(line.text) for line in self.lines) or 1
        return sum(line.size * len(line.text) for line in self.lines) / total

    @property
    def bold(self) -> bool:
        return all(line.bold for line in self.lines)

    @property
    def italic(self) -> bool:
        return sum(line.italic for line in self.lines) * 2 > len(self.lines)

    @property
    def mono(self) -> bool:
        return all(line.mono for line in self.lines)

    @property
    def math_fraction(self) -> float:
        chars = sum(len(line.text.strip()) for line in self.lines) or 1
        return sum(line.math_chars for line in self.lines) / chars

    @property
    def sup_markers(self) -> list[str]:
        return [m for line in self.lines for m in line.sup_markers]


def _line(page: int, raw: dict[str, Any], *, ocr: bool) -> Line | None:
    dx, dy = raw["dir"]
    if abs(dy) > 0.1 or dx <= 0:  # rotated text: axis labels, spine text
        return None
    parts: list[str] = []
    markers: list[str] = []
    weighted = chars = bold = italic = mono = math = 0.0
    for span in raw["spans"]:
        text = span["text"]
        if span["flags"] & mupdf.SUPERSCRIPT and _MARKER.match(text) and parts:
            markers.append(text.strip())
            continue
        n = len(text.strip())
        parts.append(text)
        chars += n
        weighted += span["size"] * n
        font = span["font"]
        bold += n * bool(span["flags"] & mupdf.BOLD or "bold" in font.lower())
        italic += n * bool(span["flags"] & mupdf.ITALIC)
        if not ocr:  # OCR text layers report a monospaced "GlyphLessFont"
            monospaced = span["flags"] & mupdf.MONOSPACED
            mono += n * bool(monospaced or _MONO_FONT.search(font))
            math += n * bool(_MATH_FONT.search(font))
    text = "".join(parts).rstrip()
    if not text.strip():
        return None
    x0, y0, x1, y1 = raw["bbox"]
    return Line(
        page=page,
        bbox=(round(x0, 1), round(y0, 1), round(x1, 1), round(y1, 1)),
        text=text,
        size=round(weighted / chars, 1) if chars else 0.0,
        bold=bold * 2 > chars,
        italic=italic * 2 > chars,
        mono=mono >= chars * 0.8,
        math_chars=int(math),
        sup_markers=markers,
    )


def extract_blocks(
    page: pymupdf.Page, page_no: int, textpage: pymupdf.TextPage | None = None
) -> list[Block]:
    """One page's text as typographically uniform blocks, in MuPDF order."""
    raw = mupdf.page_text_dict(page, textpage)
    blocks: list[Block] = []
    for raw_block in raw["blocks"]:
        if raw_block.get("type") != 0:
            continue
        lines = [
            line
            for raw_line in raw_block["lines"]
            if (line := _line(page_no, raw_line, ocr=textpage is not None))
        ]
        blocks.extend(split_runs(page_no, lines))
    return blocks


def _breaks(prev: Line, line: Line, run: list[Line]) -> bool:
    if prev.mono != line.mono or abs(prev.size - line.size) > 1.0:
        return True
    if prev.bold != line.bold and (len(run) == 1 or len(line.text) < 60):
        return True  # a bold heading line glued to its paragraph
    if line.bbox[1] - prev.bbox[3] > max(prev.size, line.size) * 1.0:
        return True
    if any(p.match(line.text.strip()) for p in _CAPTIONS):
        return True
    starts_item = list_marker(line.text) is not None
    in_list = list_marker(run[0].text) is not None
    if starts_item and not in_list:
        return True
    return in_list and not starts_item and line.bbox[0] <= run[0].bbox[0] + 1.0


def split_runs(page_no: int, lines: list[Line]) -> list[Block]:
    """Split MuPDF lines where font kind, size, spacing, captions or lists change."""
    runs: list[list[Line]] = []
    for line in lines:
        if runs and not _breaks(runs[-1][-1], line, runs[-1]):
            runs[-1].append(line)
        else:
            runs.append([line])
    return [Block(page=page_no, lines=run) for run in runs]


def text_area(blocks: Sequence[Block]) -> tuple[float, float]:
    """Typical left / right edge of body text across the document.

    The 10th / 90th percentile of block edges: robust to short lines and stray margin text.
    """
    body = [b for b in blocks if len(b.text) >= 40] or list(blocks)
    if not body:
        return 0.0, 0.0
    lefts = sorted(b.bbox[0] for b in body)
    rights = sorted(b.bbox[2] for b in body)
    return lefts[len(lefts) // 10], rights[(len(rights) * 9) // 10]


def reading_order[T](
    items: list[T],
    bbox_of: Callable[[T], Bbox],
    page_width: float,
    single_column: tuple[float, float],
) -> tuple[list[T], list[tuple[float, float]]]:
    """Sort a page's items by column; return them with each item's column bounds.

    Items straddling the page middle are full-width and split the page into bands; within
    a band the left column is read before the right. With too few items on each side the
    page is single-column and sorted top-to-bottom.
    """
    mid = page_width / 2
    side = []
    for item in items:
        x0, _, x1, _ = bbox_of(item)
        side.append("L" if x1 <= mid + 5 else "R" if x0 >= mid - 5 else "F")
    if side.count("L") < 2 or side.count("R") < 2:
        ordered = sorted(items, key=lambda it: (round(bbox_of(it)[1]), bbox_of(it)[0]))
        return ordered, [single_column] * len(ordered)

    def bounds(which: str) -> tuple[float, float]:
        boxes = [bbox_of(it) for it, s in zip(items, side, strict=True) if s == which]
        return min(b[0] for b in boxes), max(b[2] for b in boxes)

    columns = {"L": bounds("L"), "R": bounds("R"), "F": single_column}
    cuts = sorted(bbox_of(items[i])[1] for i, s in enumerate(side) if s == "F")

    def band(i: int) -> int:
        return sum(1 for y in cuts if y <= bbox_of(items[i])[1])

    def key(i: int) -> tuple[int, int, float]:
        rank = {"F": 0, "L": 1, "R": 2}[side[i]]
        return band(i), rank, bbox_of(items[i])[1]

    order = sorted(range(len(items)), key=key)
    return [items[i] for i in order], [columns[side[i]] for i in order]

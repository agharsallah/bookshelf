"""Where chapters and sections start: the part of the tier ladder that differs by tier.

- Tier 1 / outline override: `place_outline()` puts each outline entry at the line on
  its page that spells its title (the line is consumed), else at the top of that page.
- Tier 2 / 3: `detect_headings()` finds heading lines by font size and weight: sizes
  clearly above the body size are ranked (largest → chapter), and numbering patterns
  (`Part II`, `Chapter 3`, `3.2`, `3.2.1`) override the rank.
"""

import re
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

from app.pipeline.parse.model import Heading, ParsedNode
from app.pipeline.parse.override import OverrideChapter
from app.pipeline.parse.pdf.layout import Block
from app.pipeline.parse.text import (
    FIGURE_CAPTION,
    LISTING_CAPTION,
    PART_RE,
    TABLE_CAPTION,
    list_marker,
    outline_levels,
    title_keys,
)

Item = Block | ParsedNode
Placed = Block | ParsedNode | Heading

CHAPTER_RE = re.compile(r"^chapter\s+(?:[ivxlc]+|\d+|[a-z]+)\b", re.IGNORECASE)
_SUBSECTION_RE = re.compile(r"^\d+\.\d+\.\d+\.?\s+\S")
_SECTION_RE = re.compile(r"^\d+\.\d+\.?\s+\S")


@dataclass(slots=True)
class OutlineEntry:
    level: int  # 0 part, 1 chapter, 2 section, 3 subsection
    title: str
    page: int  # 1-based
    meta: dict[str, Any] = field(default_factory=dict)


def _page(item: Item) -> int:
    return item.page if isinstance(item, Block) else item.page_from or 0


# --- tier 1 and override --------------------------------------------------------------------


def toc_entries(toc: Sequence[tuple[int, str, int]]) -> list[OutlineEntry]:
    """Map PDF outline levels to container levels, detecting `Part` entries."""
    live = [(lvl, title, page) for lvl, title, page in toc if page >= 1 and title.strip()]
    levels = outline_levels([(lvl, title) for lvl, title, _ in live])  # dangling ones dropped
    return [
        OutlineEntry(level=level, title=title.strip(), page=page)
        for level, (_, title, page) in zip(levels, live, strict=True)
    ]


def override_entries(chapters: list[OverrideChapter], page_count: int) -> list[OutlineEntry]:
    entries: list[OutlineEntry] = []
    for chapter in chapters:
        meta = {"skip": True} if chapter.skip else {}
        entries.append(OutlineEntry(1, chapter.title, chapter.page_from, meta))
        entries.extend(OutlineEntry(2, s.title, s.page_from) for s in chapter.sections)
    last = chapters[-1]
    if last.page_to is not None and last.page_to < page_count:
        entries.append(OutlineEntry(1, "Back matter", last.page_to + 1, {"skip": True}))
    return entries


def _match(items: list[Item], start: int, entry: OutlineEntry) -> tuple[int, int] | None:
    """`(first, end)` item indices of blocks on the entry's page that spell its title."""
    wanted = title_keys(entry.title)
    for i in range(start, len(items)):
        if _page(items[i]) != entry.page:
            break
        text = ""
        for j in range(i, min(i + 4, len(items))):
            block = items[j]
            if not isinstance(block, Block) or block.page != entry.page or len(block.text) > 200:
                break
            text = f"{text} {block.text}"
            found = title_keys(text)
            if found & wanted:
                return i, j + 1
            if not any(w.startswith(f) for w in wanted for f in found):
                break
    return None


def place_outline(items: list[Item], entries: list[OutlineEntry]) -> list[Placed]:
    """Interleave `Heading`s into the reading-order stream; matched title lines are consumed."""
    out: list[Placed] = []
    cursor = 0
    for entry in entries:
        start = next((i for i in range(cursor, len(items)) if _page(items[i]) >= entry.page), None)
        start = len(items) if start is None else start
        span = _match(items, start, entry)
        first, end = span if span else (start, start)
        out.extend(items[cursor:first])
        out.append(Heading(entry.level, entry.title, entry.page, dict(entry.meta)))
        cursor = end
    out.extend(items[cursor:])
    return out


# --- tier 2 / 3 -------------------------------------------------------------------------------


def body_size(blocks: Sequence[Block]) -> float:
    """The most common font size by character count (0 when there is no text)."""
    weights: dict[float, int] = {}
    for block in blocks:
        for line in block.lines:
            size = round(line.size * 2) / 2
            weights[size] = weights.get(size, 0) + len(line.text)
    return max(weights, key=lambda s: (weights[s], -s)) if weights else 0.0


def _pattern_level(text: str) -> int | None:
    if PART_RE.match(text):
        return 0
    if CHAPTER_RE.match(text):
        return 1
    if _SUBSECTION_RE.match(text):
        return 3
    if _SECTION_RE.match(text):
        return 2
    return None


def _candidate(block: Block, body: float) -> bool:
    text = block.text.strip()
    if block.mono or len(block.lines) > 3 or len(text) > 150 or len(text) < 2:
        return False
    if text.isdigit() or list_marker(text) or text.endswith((".", ",", ";")):
        return False
    if any(p.match(text) for p in (FIGURE_CAPTION, TABLE_CAPTION, LISTING_CAPTION)):
        return False
    bigger = block.size >= body + 1.0
    return bigger or (block.bold and _pattern_level(text) is not None)


def _continues_heading(prev: Heading, block: Block, level: int, adjacent: bool) -> bool:
    """A heading wrapped over two blocks, or a short label line above its title."""
    if not adjacent or prev.page != block.page:
        return False
    return prev.level == level or (prev.level < level and len(prev.title) < 20)


def detect_headings(items: list[Item], body: float) -> tuple[list[Placed], str | None]:
    """Replace heading-like blocks with `Heading`s; also return a title-page title."""
    cands = {i: b for i, b in enumerate(items) if isinstance(b, Block) and _candidate(b, body)}
    sized = [b for b in cands.values() if b.size >= body + 1.0 and _pattern_level(b.text) != 0]
    sizes = sorted({round(b.size * 2) / 2 for b in sized}, reverse=True)

    title: str | None = None
    if len(sizes) > 1:  # a biggest size used only on page 1 is the title page
        top = [b for b in sized if round(b.size * 2) / 2 == sizes[0]]
        page_one = sum(len(b.text) for b in items if isinstance(b, Block) and b.page == 1)
        if len(top) <= 2 and all(b.page == 1 for b in top) and page_one < 600:
            title = " ".join(b.text for b in top)
            cands = {i: b for i, b in cands.items() if b not in top}
            sizes = sizes[1:]

    def level(block: Block) -> int:
        by_pattern = _pattern_level(block.text.strip())
        if by_pattern is not None:
            return by_pattern
        size = round(block.size * 2) / 2
        rank = next((r for r, s in enumerate(sizes) if abs(s - size) < 0.75), len(sizes))
        return min(rank + 1, 3)

    out: list[Placed] = []
    for i, item in enumerate(items):
        if i not in cands:
            out.append(item)
            continue
        block, lvl = cands[i], level(cands[i])
        prev = out[-1] if out else None
        if isinstance(prev, Heading) and _continues_heading(prev, block, lvl, i - 1 in cands):
            prev.title = f"{prev.title} {block.text}"  # `Chapter 3` + `Feedback loops`
            continue
        out.append(Heading(lvl, block.text, block.page))
    return out, title

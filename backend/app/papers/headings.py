"""Paper heading detection on PDF blocks: numbered sections, named ones, appendices.

The book heuristics (`parse.pdf.headings.detect_headings`) rank font sizes, which puts a
paper's title at chapter depth and every numbered section below it. Papers are more
regular than books, so this reads their conventions instead (docs/PAPERS.md P3):

    `3 Model Architecture` → level 1 (a unit)   `3.2 Attention` → 2   `3.2.1 …` → 3
    `Abstract` `References` `Acknowledgements` `Appendix` (+ `Limitations` …) → level 1
    `A Additional Details` / `A.1 …` after the references → appendix levels 1 / 2
    an unnumbered heading set like a section, after the last numbered one → level 1
    run-in `Acknowledgements We thank …` / `Abstract—We …` → heading + paragraph

A heading must be set apart (bold, or at least ~1pt above the body size), short, and
numbered in sequence: top-level numbers run 1, 2, 3 …, and `N.M` only counts under `N`.
Blocks before the abstract (title, authors, affiliation numbers) are never headings.
"""

# Dashes, quotes and footnote marks in the patterns below are the point, not typos.
# ruff: noqa: RUF001

import dataclasses
import re
from dataclasses import dataclass, field
from statistics import median

from app.papers import sections
from app.pipeline.parse.model import Heading
from app.pipeline.parse.pdf.headings import Item, Placed
from app.pipeline.parse.pdf.layout import Block
from app.pipeline.parse.text import FIGURE_CAPTION, LISTING_CAPTION, TABLE_CAPTION

_CAPTIONS = (FIGURE_CAPTION, TABLE_CAPTION, LISTING_CAPTION)
_MAX_TITLE_WORDS = 16
_RUN_IN = re.compile(
    r"^(?P<label>abstract|acknowledge?ments?)(?:\s*[—–:.-]\s*|\s+)(?P<rest>\S.*)$",
    re.IGNORECASE,
)


@dataclass(slots=True)
class PaperHeadings:
    placed: list[Placed]
    title: str | None
    top_numbers: list[int] = field(default_factory=list)  # accepted `N Title` numbers
    gaps: int = 0  # top-level numbers skipped (a missed heading)
    has_abstract: bool = False
    has_references: bool = False


def _emphasized(block: Block, body: float) -> bool:
    text = block.text.strip()
    if block.mono or len(block.lines) > 3 or not 2 <= len(text) <= 150:
        return False
    if text.endswith((",", ";")) or any(p.match(text) for p in _CAPTIONS):
        return False
    return block.size >= body - 0.5 and (block.bold or block.size >= body + 0.75)


def _short_title(title: str) -> bool:
    return len(title.split()) <= _MAX_TITLE_WORDS and (title[:1].isupper() or title[:1].isdigit())


def _is_abstract(block: Block) -> bool:
    if sections.key(block.text) == sections.ABSTRACT:
        return True
    m = _RUN_IN.match(block.lines[0].text.strip())
    return m is not None and m.group("label").lower() == sections.ABSTRACT


def _join_wrapped(items: list[Item], body: float) -> list[Item]:
    """Glue a heading wrapped over adjacent blocks (`Appendix for "BERT: …` + `…"`)."""
    out: list[Item] = []
    for item in items:
        prev = out[-1] if out else None
        if (
            isinstance(item, Block)
            and isinstance(prev, Block)
            and _emphasized(prev, body)
            and _emphasized(item, body)
            and item.page == prev.page
            and abs(item.size - prev.size) < 0.3
            and item.bold == prev.bold
            and 0 <= item.bbox[1] - prev.bbox[3] < item.size * 0.8
            and sections.numbering(item.text, lettered=True) is None
            and not sections.is_named(item.text)
            and sections.key(prev.text) not in sections.NAMED
            and len(prev.lines) + len(item.lines) <= 3
        ):
            out[-1] = Block(page=prev.page, lines=[*prev.lines, *item.lines], column=prev.column)
            continue
        out.append(item)
    return out


def _split_run_in(block: Block) -> tuple[str, Block] | None:
    """`Acknowledgements We thank …` → ("Acknowledgements", block of the rest)."""
    m = _RUN_IN.match(block.lines[0].text.strip())
    if m is None or len(block.text) < 40:
        return None
    first = dataclasses.replace(block.lines[0], text=m.group("rest"))
    label = m.group("label")
    return label[:1].upper() + label[1:].lower(), Block(
        page=block.page, lines=[first, *block.lines[1:]], column=block.column
    )


def _title(items: list[Item], first_heading: int, body: float) -> str | None:
    """The largest type on page one above the first heading: the paper's title."""
    head = [
        b
        for b in items[:first_heading]
        if isinstance(b, Block) and b.page == 1 and b.size >= body + 2
    ]
    if not head:
        return None
    top = max(b.size for b in head)
    parts = [b.text.strip() for b in head if abs(b.size - top) < 0.3]
    return " ".join(parts)[:500] or None


class _Walk:
    """One pass over the stream, tracking the numbering sequence and the zone."""

    def __init__(self, body: float, abstract_at: int | None) -> None:
        self.body = body
        self.abstract_at = abstract_at
        self.expected = 1
        self.top: str | None = None
        self.result = PaperHeadings(placed=[], title=None)
        self.in_appendix = False
        self.started = False
        self.top_sizes: list[float] = []

    def level(self, index: int, block: Block) -> int | None:
        """The heading level of an emphasized block, or None when it is not a heading."""
        text = block.text.strip()
        if sections.is_named(text):
            return 1
        before_abstract = self.abstract_at is not None and index < self.abstract_at
        num = sections.numbering(text, lettered=self.in_appendix)
        if num is not None and not before_abstract and _short_title(num.title):
            return self._numbered(num)
        if num is None and self.started and self.result.top_numbers and self._section_sized(block):
            return 1 if self.after_last_numbered else None
        return None

    @property
    def after_last_numbered(self) -> bool:
        return self.result.has_references or self.in_appendix

    def _section_sized(self, block: Block) -> bool:
        return bool(self.top_sizes) and block.bold and block.size >= median(self.top_sizes) - 0.3

    def _numbered(self, num: sections.Numbering) -> int | None:
        head = num.parts[0]
        if num.depth == 1:
            if head.isdigit() and not self.in_appendix:
                n = int(head)
                if n not in (self.expected, self.expected + 1):
                    return None
                self.result.gaps += n - self.expected
                self.result.top_numbers.append(n)
                self.expected = n + 1
            self.top = head
            return 1
        if head != self.top:
            return None
        return min(num.depth, 3)

    def emit(self, heading: Heading, block: Block | None) -> None:
        text = heading.title
        k = sections.key(text)
        if heading.level == 1:
            self.started = True
            if k == sections.ABSTRACT:
                self.result.has_abstract = True
            if k in sections.REFERENCES:
                self.result.has_references = True
                self.in_appendix = True  # lettered headings may follow
            if sections.is_appendix_label(text):
                self.in_appendix = True
            if block is not None and sections.numbering(text) is not None:
                self.top_sizes.append(block.size)
        self.result.placed.append(heading)


def detect_paper_headings(items: list[Item], body: float) -> PaperHeadings:
    """Replace heading blocks with `Heading`s following paper conventions (module doc)."""
    stream = _join_wrapped(items, body)
    abstract_at = next(
        (i for i, b in enumerate(stream) if isinstance(b, Block) and _is_abstract(b)), None
    )
    walk = _Walk(body, abstract_at)
    first_heading: int | None = None
    for i, item in enumerate(stream):
        if not isinstance(item, Block):
            walk.result.placed.append(item)
            continue
        level = walk.level(i, item) if _emphasized(item, body) else None
        if level is None and sections.is_named(item.text) and len(item.lines) == 1:
            level = 1  # `References` set in body type is still the references
        if level is not None:
            first_heading = i if first_heading is None else first_heading
            walk.emit(Heading(level, item.text.strip(), item.page), item)
            continue
        split = _split_run_in(item) if (walk.started or i == abstract_at) else None
        if split is not None:
            first_heading = i if first_heading is None else first_heading
            walk.emit(Heading(1, split[0], item.page), None)
            walk.result.placed.append(split[1])
            continue
        walk.result.placed.append(item)
    walk.result.title = _title(stream, first_heading or len(stream), body)
    return walk.result

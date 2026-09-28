"""One paragraph per bibliography entry, rebuilt from PDF lines under the References heading.

MuPDF splits an entry wherever its hanging indent starts (`Alan Akbik, …` | `2018.
Contextual …`), and the prose rules then read the indented rest as a quote. Here the
lines between the references heading and the next top-level heading are regrouped:

    numbered style ([n] / n.)  a line opening with the next marker starts an entry
    hanging indent             a line at the column's left edge starts an entry; indented
                               lines (also at the top of the next column / page) continue it
    neither                    MuPDF's blocks are the entries

Each entry becomes a paragraph with `meta.reference = true`, which `papers.refparse`
takes as one entry as is.
"""

from dataclasses import dataclass

from app.models.enums import NodeKind
from app.papers import sections
from app.papers.refparse import entry_marker
from app.pipeline.parse.model import Heading, ParsedNode
from app.pipeline.parse.pdf.headings import Placed
from app.pipeline.parse.pdf.layout import Block, Line
from app.pipeline.parse.text import join_lines

_INDENT = 4.0  # points: a line this far right of the edge continues an entry
_NUMBERED_SHARE = 0.5


@dataclass(slots=True)
class _Line:
    line: Line
    group: tuple[int, float]  # (page, column left)
    block_start: bool


def _lines(blocks: list[Block]) -> list[_Line]:
    return [
        _Line(line, (block.page, block.column[0]), i == 0)
        for block in blocks
        for i, line in enumerate(block.lines)
    ]


def _numbered(lines: list[_Line]) -> bool:
    starts = [ln for ln in lines if ln.block_start]
    marked = sum(1 for ln in starts if entry_marker(ln.line.text) is not None)
    return bool(starts) and marked >= len(starts) * _NUMBERED_SHARE


def _starts(lines: list[_Line]) -> list[bool]:
    if _numbered(lines):
        return [entry_marker(ln.line.text) is not None for ln in lines]
    edges: dict[tuple[int, float], float] = {}
    for ln in lines:
        edges[ln.group] = min(edges.get(ln.group, ln.line.bbox[0]), ln.line.bbox[0])
    hanging = any(ln.line.bbox[0] > edges[ln.group] + _INDENT for ln in lines)
    if not hanging:
        return [ln.block_start for ln in lines]
    return [ln.line.bbox[0] <= edges[ln.group] + _INDENT / 2 for ln in lines]


def _entry(lines: list[Line]) -> ParsedNode:
    return ParsedNode(
        NodeKind.PARAGRAPH,
        text=join_lines([ln.text for ln in lines]),
        page_from=lines[0].page,
        page_to=lines[-1].page,
        meta={"reference": True},
    )


def merge_entries(blocks: list[Block]) -> list[ParsedNode]:
    """The bibliography's blocks regrouped as one paragraph per entry."""
    lines = _lines(blocks)
    entries: list[list[Line]] = []
    for ln, start in zip(lines, _starts(lines), strict=True):
        if start or not entries:
            entries.append([ln.line])
        else:
            entries[-1].append(ln.line)
    return [_entry(e) for e in entries]


def regroup_references(placed: list[Placed]) -> list[Placed]:
    """Replace the blocks of each references section with one paragraph per entry."""
    out: list[Placed] = []
    zone: list[Block] | None = None
    for item in placed:
        if isinstance(item, Heading) and item.level <= 1:
            if zone:
                out.extend(merge_entries(zone))
            zone = [] if sections.key(item.title) in sections.REFERENCES else None
            out.append(item)
        elif zone is not None and isinstance(item, Block):
            zone.append(item)
        else:
            if zone:  # a figure inside the bibliography: keep the order around it
                out.extend(merge_entries(zone))
                zone = []
            out.append(item)
    if zone:
        out.extend(merge_entries(zone))
    return out

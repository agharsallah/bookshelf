"""Markdown → `ParsedDocument`: a small line-oriented parser for the block kinds (§8).

Headings → tree (a single leading `# Title` is the document title; the remaining
shallowest level → chapters), fenced / indented blocks → `code`, pipe tables → `table`,
`$$ … $$` → `math`, standalone images → `figure`, `>` → `quote` (GitHub `> [!NOTE]`
alerts → `aside`), bullets / numbers → `list`. YAML front matter supplies title, authors
and year. Inline markup stays in the text as written.
"""

import re
from collections.abc import Callable, Iterator
from typing import Any

import yaml

from app.models.enums import NodeKind
from app.pipeline.parse.anchors import assign_anchors
from app.pipeline.parse.model import Event, Heading, ParsedDocument, ParsedNode, ParseError
from app.pipeline.parse.text import aside_label, join_lines, list_marker, list_text, table_text
from app.pipeline.parse.tree import build_tree

_HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")
_FENCE = re.compile(r"^(```+|~~~+)\s*([\w+#.-]*)")
_TABLE_RULE = re.compile(r"^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$")
_IMAGE = re.compile(r"^!\[([^\]]*)\]\((\S+?)(?:\s+\"([^\"]*)\")?\)\s*$")
_ALERT = re.compile(r"^\[!(\w+)\]\s*(.*)$")
_YEAR = re.compile(r"\b(\d{4})\b")


def _cells(line: str) -> list[str]:
    return [c.strip() for c in line.strip().strip("|").split("|")]


def _front_matter(lines: list[str]) -> tuple[dict[str, Any], list[str]]:
    if not lines or lines[0].strip() != "---":
        return {}, lines
    for i, line in enumerate(lines[1:], 1):
        if line.strip() in ("---", "..."):
            try:
                data = yaml.safe_load("\n".join(lines[1:i])) or {}
            except yaml.YAMLError:
                return {}, lines
            return (data if isinstance(data, dict) else {}), lines[i + 1 :]
    return {}, lines


def _leaf(kind: NodeKind, text: str, **meta: object) -> ParsedNode:
    return ParsedNode(kind, text=text, meta=meta)


class _Scanner:
    """Consumes lines block by block; each `_read_*` method leaves `i` after its block."""

    def __init__(self, lines: list[str]) -> None:
        self.lines, self.i = lines, 0

    def line(self, offset: int = 0) -> str:
        j = self.i + offset
        return self.lines[j] if j < len(self.lines) else ""

    def more(self) -> bool:
        return self.i < len(self.lines)

    def take_while(self, keep: Callable[[str], bool]) -> list[str]:
        taken: list[str] = []
        while self.more() and keep(self.line()):
            taken.append(self.line())
            self.i += 1
        return taken

    def starts_block(self) -> bool:
        raw, line = self.line(), self.line().strip()
        return bool(
            _HEADING.match(raw) or _FENCE.match(line) or line.startswith(("$$", ">"))
            or list_marker(raw) or _IMAGE.match(line) or self.at_table()
        )  # fmt: skip

    def at_table(self) -> bool:
        return "|" in self.line() and bool(_TABLE_RULE.match(self.line(1)))

    def blocks(self) -> Iterator[Event | tuple[int, str]]:
        """Leaves, and `(rank, title)` for headings (ranks are resolved by the caller)."""
        while self.more():
            raw, line = self.line(), self.line().strip()
            if not line:
                self.i += 1
            elif m := _HEADING.match(raw):
                self.i += 1
                yield len(m.group(1)), m.group(2)
            elif m := _FENCE.match(line):
                yield self._read_fence(m.group(1), m.group(2))
            elif line.startswith("$$"):
                yield self._read_math()
            elif self.at_table():
                yield self._read_table()
            elif m := _IMAGE.match(line):
                self.i += 1
                caption = m.group(3) or m.group(1) or None
                yield _leaf(NodeKind.FIGURE, caption or "", src=m.group(2), alt=m.group(1),
                            caption=caption, image_path=None)  # fmt: skip
            elif line.startswith(">"):
                yield self._read_quote()
            elif (marker := list_marker(raw)) is not None:
                yield self._read_list(ordered=marker[0])
            elif raw.startswith(("    ", "\t")):
                yield self._read_indented_code()
            else:
                yield self._read_paragraph()

    def _read_fence(self, fence: str, language: str) -> ParsedNode:
        self.i += 1
        body = self.take_while(lambda line: not line.strip().startswith(fence))
        self.i += 1  # the closing fence
        return _leaf(NodeKind.CODE, "\n".join(body), language=language.lower() or None,
                     caption=None, listing_no=None)  # fmt: skip

    def _read_math(self) -> ParsedNode:
        body = [self.line().strip()[2:]]
        while not body[-1].rstrip().endswith("$$") and self.i + 1 < len(self.lines):
            self.i += 1
            body.append(self.line())
        self.i += 1
        latex = "\n".join(body).rstrip().removesuffix("$$").strip()
        return _leaf(NodeKind.MATH, latex, inline=False, latex=latex, image_path=None)

    def _read_table(self) -> ParsedNode:
        header = _cells(self.line())
        self.i += 2  # header and |---| rule
        rows = [_cells(r) for r in self.take_while(lambda line: "|" in line and bool(line.strip()))]
        return _leaf(NodeKind.TABLE, table_text(header, rows),
                     table={"header": header, "rows": rows}, caption=None)  # fmt: skip

    def _read_quote(self) -> ParsedNode:
        quoted = self.take_while(lambda line: line.strip().startswith(">"))
        body = [line.strip()[1:].strip() for line in quoted]
        if alert := _ALERT.match(body[0]):
            text = join_lines([alert.group(2), *body[1:]])
            return _leaf(NodeKind.ASIDE, text, label=alert.group(1).capitalize())
        return _leaf(NodeKind.QUOTE, join_lines(body))

    def _read_list(self, *, ordered: bool) -> ParsedNode:
        items: list[str] = []
        while self.more() and self.line().strip():
            if marker := list_marker(self.line()):
                items.append(marker[1].strip())
            elif self.line().startswith((" ", "\t")) and items:
                items[-1] = join_lines([items[-1], self.line()])
            else:
                break
            self.i += 1
        return _leaf(NodeKind.LIST, list_text(items, ordered=ordered), items=items,
                     ordered=ordered)  # fmt: skip

    def _read_indented_code(self) -> ParsedNode:
        body = self.take_while(lambda line: line.startswith(("    ", "\t")) or not line.strip())
        code = "\n".join(line[4:] if line.startswith("    ") else line[1:] for line in body)
        return _leaf(NodeKind.CODE, code.strip("\n"), language=None, caption=None,
                     listing_no=None)  # fmt: skip

    def _read_paragraph(self) -> ParsedNode:
        body = [self.line()]
        self.i += 1
        while self.more() and self.line().strip() and not self.starts_block():
            body.append(self.line())
            self.i += 1
        text = join_lines(body)
        if labelled := aside_label(text):
            return _leaf(NodeKind.ASIDE, labelled[1] or text, label=labelled[0])
        return _leaf(NodeKind.PARAGRAPH, text)


def parse_markdown(source: str) -> ParsedDocument:
    meta, lines = _front_matter(source.replace("\r\n", "\n").split("\n"))
    raw = list(_Scanner(lines).blocks())
    headings = [e for e in raw if isinstance(e, tuple)]
    title = str(meta.get("title") or "").strip() or None
    if headings and headings[0][0] == 1 and sum(1 for r, _ in headings if r == 1) == 1:
        title = title or headings[0][1]
        raw.remove(headings[0])  # the document title, not a chapter
        headings = headings[1:]
    ranks = sorted({r for r, _ in headings})
    events: list[Event] = [] if headings else [Heading(1, title or "Document")]
    for item in raw:
        if isinstance(item, tuple):
            events.append(Heading(level=min(1 + ranks.index(item[0]), 3), title=item[1]))
        else:
            events.append(item)
    authors = meta.get("authors") or meta.get("author") or []
    year = _YEAR.search(str(meta.get("year") or meta.get("date") or ""))
    parsed = ParsedDocument(
        title=title,
        authors=[str(a) for a in authors] if isinstance(authors, list) else [str(authors)],
        year=int(year.group(1)) if year else None,
        tier=1,
        language=str(meta["language"]) if meta.get("language") else None,
        children=build_tree(events),
    )
    if not any(not n.kind.is_container for n in parsed.walk()):
        raise ParseError("the Markdown file has no content")
    assign_anchors(parsed.children)
    return parsed

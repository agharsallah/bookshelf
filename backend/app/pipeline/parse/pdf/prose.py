"""The prose path: text blocks → paragraph / list / quote / code / math / aside leaves.

Runs after headings are placed, over the whole document's stream, so it can merge a
paragraph that continues across a page break, glue list items MuPDF split into separate
blocks, and pair `Listing N.M` captions with their code.
"""

import re
from dataclasses import dataclass

from app.models.enums import NodeKind
from app.pipeline.parse.model import Crop, Heading, ParsedNode
from app.pipeline.parse.pdf import geometry as geo
from app.pipeline.parse.pdf.layout import Block
from app.pipeline.parse.text import (
    LISTING_CAPTION,
    MATH_SYMBOLS,
    aside_label,
    guess_language,
    join_lines,
    latex_from_text,
    list_marker,
    list_text,
)

Placed = Block | ParsedNode | Heading

_SENTENCE_END = re.compile(r"[.!?:;\"\u201d\u2019)\]]$")
_EQUATION_NO = re.compile(r"\s*\((\d+(?:\.\d+)*)\)\s*$")
_LONG_WORD = re.compile(r"[A-Za-z]{4,}")
_FOOTNOTE = re.compile(r"^(\d{1,3}|[*\u2020\u2021\u00a7])\s*(\S.*)$")


@dataclass(slots=True)
class Footnote:
    page: int
    marker: str
    text: str


# --- footnotes ------------------------------------------------------------------------------


def split_footnotes(
    blocks: list[Block], page_height: float, body: float
) -> tuple[list[Block], list[Footnote]]:
    """Small-type numbered blocks at the page bottom are footnotes, not prose."""
    notes: list[Footnote] = []
    keep: list[Block] = []
    for block in blocks:
        low = block.bbox[1] >= page_height * 0.7
        small = body > 0 and block.size <= body - 1.0
        if not (low and small and _FOOTNOTE.match(block.text)):
            keep.append(block)
            continue
        for line in block.lines:
            if m := _FOOTNOTE.match(line.text.strip()):
                notes.append(Footnote(block.page, m.group(1), m.group(2).strip()))
            elif notes:
                notes[-1].text = join_lines([notes[-1].text, line.text])
    return keep, notes


def attach_footnotes(
    events: list[Heading | ParsedNode], notes: list[Footnote], refs: dict[int, list[str]]
) -> None:
    """Attach each footnote to the leaf citing its marker, else the page's last leaf."""
    for note in notes:
        on_page = [
            e
            for e in events
            if isinstance(e, ParsedNode) and e.page_from is not None
            and e.page_from <= note.page <= (e.page_to or e.page_from)
        ]  # fmt: skip
        owner = next((e for e in on_page if note.marker in refs.get(id(e), [])), None)
        owner = owner or (on_page[-1] if on_page else None)
        if owner is not None:
            owner.meta.setdefault("footnotes", []).append(
                {"marker": note.marker, "text": note.text}
            )


# --- block kinds ------------------------------------------------------------------------------


def _centered_short(block: Block) -> bool:
    col0, col1 = block.column
    width = col1 - col0
    x0, _, x1, _ = block.bbox
    if width <= 0:
        return False
    middle = abs((x0 + x1) / 2 - (col0 + col1) / 2) < width * 0.1
    return middle and x1 - x0 < width * 0.6 and x0 > col0 + width * 0.1


_MIN_FORMULA_CHARS = 3  # a lone `→` or `x` set apart is typography, not a formula


def is_display_math(block: Block) -> bool:
    text = block.text
    if len("".join(text.split())) < _MIN_FORMULA_CHARS:
        return False
    if block.math_fraction >= 0.5 and len(text) <= 300:
        return True
    if len(block.lines) > 2 or not _centered_short(block):
        return False
    return any(ch in MATH_SYMBOLS for ch in text) and len(_LONG_WORD.findall(text)) <= 1


def is_quote(block: Block) -> bool:
    col0, col1 = block.column
    x0, _, x1, _ = block.bbox
    indented = col1 - col0 > 100 and x0 >= col0 + 18 and x1 <= col1 - 18
    return indented and (len(block.lines) >= 2 or block.italic)


def code_text(blocks: list[Block]) -> str:
    """Monospace lines with indentation rebuilt from x offsets and blank lines from gaps."""
    lines = [line for block in blocks for line in block.lines]
    left = min(line.bbox[0] for line in lines)
    out: list[str] = []
    prev_bottom: float | None = None
    for line in lines:
        if prev_bottom is not None and line.bbox[1] - prev_bottom > line.size * 0.9:
            out.append("")
        lead = len(line.text) - len(line.text.lstrip(" "))
        indent = max(lead, round((line.bbox[0] - left) / (line.size * 0.6 or 1)))
        out.append(" " * indent + line.text.strip())
        prev_bottom = line.bbox[3]
    return "\n".join(out)


def _leaf(kind: NodeKind, block: Block, text: str, **meta: object) -> ParsedNode:
    return ParsedNode(kind, text=text, page_from=block.page, page_to=block.page, meta=meta)


# --- the stream -------------------------------------------------------------------------------


class _Builder:
    def __init__(self) -> None:
        self.out: list[Heading | ParsedNode] = []
        self.refs: dict[int, list[str]] = {}
        self.code_blocks: dict[int, list[Block]] = {}
        self.last_block: Block | None = None
        self.pending_label: str | None = None
        self.pending_listing: tuple[str, str] | None = None

    @property
    def prev(self) -> ParsedNode | None:
        last = self.out[-1] if self.out else None
        return last if isinstance(last, ParsedNode) else None

    def emit(self, node: ParsedNode, block: Block | None = None) -> None:
        self.out.append(node)
        if block is not None and block.sup_markers:
            self.refs.setdefault(id(node), []).extend(block.sup_markers)

    def adjacent(self, block: Block) -> bool:
        """The previous emitted leaf came from the block right above this one."""
        last = self.last_block
        if last is None or last.page != block.page or last.column != block.column:
            return False
        return 0 <= block.bbox[1] - last.bbox[3] <= 2.5 * max(block.size, 1.0)

    def code(self, block: Block) -> None:
        prev = self.prev
        if prev is not None and prev.kind is NodeKind.CODE and self.adjacent(block):
            blocks = self.code_blocks[id(prev)]
            blocks.append(block)
            prev.text = code_text(blocks)
            return
        node = _leaf(NodeKind.CODE, block, "", language=None, caption=None, listing_no=None)
        if self.pending_listing:
            node.meta["caption"], node.meta["listing_no"] = self.pending_listing
            self.pending_listing = None
        self.code_blocks[id(node)] = [block]
        node.text = code_text([block])
        self.emit(node)

    def listing_caption(self, block: Block, number: str) -> None:
        prev = self.prev
        if prev is not None and prev.kind is NodeKind.CODE and prev.meta["caption"] is None:
            prev.meta["caption"], prev.meta["listing_no"] = block.text, number
        else:
            self.pending_listing = (block.text, number)

    def list_item(self, block: Block) -> None:
        items: list[str] = []
        ordered = False
        for line in block.lines:
            if marker := list_marker(line.text):
                ordered = marker[0] if not items else ordered
                items.append(marker[1].strip())
            elif items:
                items[-1] = join_lines([items[-1], line.text])
        prev = self.prev
        if prev is not None and prev.kind is NodeKind.LIST and prev.meta["ordered"] == ordered:
            prev.meta["items"].extend(items)
            prev.text = list_text(prev.meta["items"], ordered=ordered)
            prev.page_to = block.page
            return
        self.emit(_leaf(NodeKind.LIST, block, list_text(items, ordered=ordered),
                        items=items, ordered=ordered), block)  # fmt: skip

    def paragraph(self, block: Block) -> None:
        text, prev = block.text, self.prev
        if self.pending_label is not None:
            label, self.pending_label = self.pending_label, None
            self.emit(_leaf(NodeKind.ASIDE, block, text, label=label), block)
            return
        if prev is not None and self._continues(prev, block):
            prev.text = join_lines([prev.text or "", text])
            prev.page_to = block.page
            self.refs.setdefault(id(prev), []).extend(block.sup_markers)
            return
        self.emit(_leaf(NodeKind.PARAGRAPH, block, text), block)

    def block(self, block: Block) -> None:
        text = block.text.strip()
        if block.mono and (len(block.lines) >= 2 or self._continues_code(block)):
            self.code(block)
        elif m := LISTING_CAPTION.match(text):
            self.listing_caption(block, m.group(1))
        elif is_display_math(block):
            number = _EQUATION_NO.search(text)
            formula = _EQUATION_NO.sub("", text) if number else text
            node = _leaf(NodeKind.MATH, block, formula, inline=False,
                         latex=latex_from_text(formula),
                         equation_no=number.group(1) if number else None,
                         page=block.page, bbox=list(block.bbox))  # fmt: skip
            node.crop = Crop(block.page, geo.pad(block.bbox, 2))
            self.emit(node, block)
        elif list_marker(block.lines[0].text):
            self.list_item(block)
        elif labelled := aside_label(text):
            if labelled[1]:
                self.emit(_leaf(NodeKind.ASIDE, block, labelled[1], label=labelled[0]), block)
            else:
                self.pending_label = labelled[0]
        elif is_quote(block):
            self.emit(_leaf(NodeKind.QUOTE, block, text), block)
        else:
            self.paragraph(block)
        self.last_block = block

    def _continues(self, prev: ParsedNode, block: Block) -> bool:
        """A paragraph cut by a page or column break: no sentence end, lowercase restart."""
        last = self.last_block
        if prev.kind is not NodeKind.PARAGRAPH or last is None or not prev.text:
            return False
        moved = last.page != block.page or last.column != block.column
        return moved and not _SENTENCE_END.search(prev.text) and block.text[:1].islower()

    def _continues_code(self, block: Block) -> bool:
        prev = self.prev
        return prev is not None and prev.kind is NodeKind.CODE and self.adjacent(block)


def build_leaves(
    stream: list[Placed],
) -> tuple[list[Heading | ParsedNode], dict[int, list[str]]]:
    """Turn the remaining `Block`s into leaves; also return footnote refs per leaf id."""
    builder = _Builder()
    for item in stream:
        if isinstance(item, Block):
            builder.block(item)
            continue
        if builder.pending_label is not None:  # a lone label before a heading or a figure
            label = builder.pending_label
            builder.out.append(ParsedNode(NodeKind.ASIDE, text=label, meta={"label": label}))
            builder.pending_label = None
        builder.out.append(item)
        builder.last_block = None
    return builder.out, builder.refs


def finish_code(events: list[Heading | ParsedNode]) -> None:
    """Guess each code block's language once its text is complete."""
    for event in events:
        if isinstance(event, ParsedNode) and event.kind is NodeKind.CODE:
            event.meta["language"] = guess_language(event.text or "")

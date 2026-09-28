"""XHTML content documents → the parser's flat event stream (§8 block kinds).

The walker reads each spine document in order. Inline content accumulates into the
current paragraph; a block element (`p`, `pre`, `table`, `figure`, display math, a
standalone image, ...) closes it. Table-of-contents entries become `Heading`s where their
`#fragment` target sits (or at the top of the document), and the heading line that
repeats the entry's title right after it is consumed, as the PDF parser does.

Headings that are not in the table of contents are "loose": after the walk they nest one
level below the entry they follow, ranked by `h1`…`h6` within it (or, with no table of
contents at all, across the book). One that would sink below subsection level stays a
paragraph; one with nothing under it is dropped (e.g. `Footnotes` once notes are lifted).
"""

import re
from collections.abc import Callable
from dataclasses import dataclass, field

from lxml import etree

from app.models.enums import NodeKind
from app.pipeline.parse.anchors import normalize_text
from app.pipeline.parse.dom import Element, attr, children, local_name, text_of
from app.pipeline.parse.epub.notes import Note, Notes
from app.pipeline.parse.epub.package import resolve
from app.pipeline.parse.html import paragraph_leaf
from app.pipeline.parse.mathml import is_display, mathml_to_tex
from app.pipeline.parse.model import Event, Heading, ParsedNode
from app.pipeline.parse.text import aside_label, guess_language, list_text, table_text, title_keys

HEADINGS = frozenset({"h1", "h2", "h3", "h4", "h5", "h6"})
# fmt: off
BLOCKS = HEADINGS | frozenset({
    "address", "article", "aside", "blockquote", "body", "center", "dd", "details", "div", "dl",
    "dt", "fieldset", "figcaption", "figure", "footer", "header", "hgroup", "hr", "li", "main",
    "ol", "p", "pre", "section", "summary", "table", "ul",
})
SKIPPED = frozenset({
    "head", "script", "style", "nav", "template", "noscript", "title", "link", "meta",
})
# fmt: on
IMAGES = frozenset({"img", "svg", "object", "image"})
MAX_TITLE_LINE = 200  # longer text is never a heading line
_LANGUAGE = re.compile(r"\b(?:language|lang)-([\w+#-]+)", re.IGNORECASE)
_PAGE = re.compile(r"^\d{1,5}$")
_SVG_NS = "http://www.w3.org/2000/svg"


@dataclass(frozen=True, slots=True)
class ImageSource:
    """Where a figure's pixels come from: a zip member, or an inline `<svg>`."""

    path: str | None = None
    svg: bytes | None = None


_COVER = ImageSource()  # sentinel: the cover image, never a figure


@dataclass(slots=True)
class _Loose:
    index: int  # into the event list
    rank: int  # 1..6 from h1..h6
    group: int  # which ToC entry it follows
    base: int  # that entry's level (0 when the book has no ToC)


@dataclass(slots=True)
class _Expect:
    """Title keys of the ToC entry just placed; lines spelling it are consumed."""

    keys: set[str]
    text: str = ""
    held: list[Callable[[], None]] = field(default_factory=list)


Targets = dict[str, list[tuple[str | None, Heading]]]  # document → (fragment, heading)


class Walker:
    def __init__(self, notes: Notes, targets: Targets, *, cover: str | None) -> None:
        self.notes, self.targets, self.cover = notes, targets, cover
        self.events: list[Event] = []
        self.images: dict[int, ImageSource] = {}  # id(figure node) → source
        self.page: int | None = None
        self.max_page: int | None = None
        self.unplaced: list[str] = []
        self._parts: list[str] = []  # the paragraph being collected
        self._refs: list[Note] = []  # notes cited since the last leaf
        self._loose: list[_Loose] = []
        self._group = 0
        self._base: int | None = None if targets else 0
        self._expect: _Expect | None = None
        self._path = ""
        self._pending: dict[str, list[Heading]] = {}
        self._handlers: dict[str, Callable[[Element], None]] = {
            "pre": self._code, "ul": self._list, "ol": self._list, "dl": self._definitions,
            "table": self._table, "figure": self._figure, "blockquote": self._quote,
            "aside": self._aside, "hr": lambda el: None,
        }  # fmt: skip

    # --- documents ----------------------------------------------------------------------

    def document(self, path: str, root: Element) -> None:
        self._path = path
        ids = {key for el in root.iter() if (key := el.get("id") or el.get("name"))}
        start: list[Heading] = []
        self._pending = {}
        for fragment, heading in self.targets.get(path, []):
            if fragment is None or fragment not in ids:
                start.append(heading)
            else:
                self._pending.setdefault(fragment, []).append(heading)
        self._place(start)
        body = next((el for el in root.iter() if local_name(el) == "body"), root)
        self._children(body)
        self._flush()
        self.unplaced.extend(h.title for hs in self._pending.values() for h in hs)

    def finish(self) -> list[Event]:
        """The event stream with loose headings levelled (or demoted, or dropped)."""
        self._release()
        levels: dict[int, int | None] = {}  # loose heading index → level (None: paragraph)
        for group in {loose.group for loose in self._loose}:
            members = [loose for loose in self._loose if loose.group == group]
            ranks = sorted({loose.rank for loose in members})
            for loose in members:
                depth = loose.base + 1 + ranks.index(loose.rank)
                levels[loose.index] = depth if depth <= 3 else None

        def level_at(i: int) -> int | None:
            """The level of event `i` if it is (still) a heading, else None."""
            event = self.events[i]
            if not isinstance(event, Heading):
                return None
            return levels.get(i, event.level)

        out: list[Event] = []
        for i, event in enumerate(self.events):
            if i not in levels or not isinstance(event, Heading):
                out.append(event)
                continue
            level = levels[i]
            if level is None:
                out.append(ParsedNode(NodeKind.PARAGRAPH, text=event.title,
                                      page_from=event.page, page_to=event.page))  # fmt: skip
                continue
            following = level_at(i + 1) if i + 1 < len(self.events) else level
            if following is not None and following <= level:
                continue  # nothing under it
            event.level = level
            out.append(event)
        return out

    # --- the walk -----------------------------------------------------------------------

    def _children(self, el: Element) -> None:
        if el.text:
            self._parts.append(el.text)
        for child in el:
            if isinstance(child.tag, str):
                self._node(child)
            if child.tail:
                self._parts.append(child.tail)

    def _node(self, el: Element) -> None:
        tag = local_name(el)
        if tag in SKIPPED or self.notes.is_hidden(el):
            return
        self._target(el)
        if self._page_mark(el):
            return
        if tag == "a" and (note := self.notes.cited(el)):
            self._refs.append(note)
        elif tag == "math":
            tex = mathml_to_tex(el)
            if is_display(el):
                self._flush()
                meta = {"inline": False, "latex": tex, "image_path": None}
                self._leaf(ParsedNode(NodeKind.MATH, text=tex, meta=meta))
            elif tex:
                self._parts.append(f"\\({tex}\\)")
        elif tag == "br":
            self._parts.append(" ")
        elif tag in IMAGES:
            if self._standalone(el):
                self._flush()
                self._image_figure(el, caption=None)
        elif tag in HEADINGS:
            self._flush()
            self._heading(el)
        elif tag in BLOCKS:
            self._flush()
            self._handlers.get(tag, self._children)(el)
            self._flush()
        else:
            self._children(el)  # inline markup (and unknown tags) flow into the paragraph

    def _inline(self, el: Element, *, skip: Element | None = None) -> str:
        """An element's text for a leaf built whole (list item, cell, caption, heading)."""
        parts: list[str] = []

        def walk(node: Element) -> None:
            tag = local_name(node)
            if tag in SKIPPED or self.notes.is_hidden(node) or node is skip:
                return
            self._target(node)
            if self._page_mark(node):
                return
            if tag == "a" and (note := self.notes.cited(node)):
                self._refs.append(note)
                return
            if tag == "math":
                parts.append(f"\\({mathml_to_tex(node)}\\)")
                return
            if tag == "br":
                parts.append(" ")
            if node.text:
                parts.append(node.text)
            for child in node:
                if isinstance(child.tag, str):
                    walk(child)
                if child.tail:
                    parts.append(child.tail)

        walk(el)
        return normalize_text("".join(parts))

    # --- placement ----------------------------------------------------------------------

    def _target(self, el: Element) -> None:
        key = el.get("id") or el.get("name")
        if key and key in self._pending:
            self._flush()
            self._place(self._pending.pop(key))

    def _place(self, headings: list[Heading]) -> None:
        if not headings:
            return
        self._release()
        keys: set[str] = set()
        for heading in headings:
            heading.page = self.page
            self.events.append(heading)
            keys |= title_keys(heading.title)
        self._base = headings[-1].level
        self._group += 1
        self._expect = _Expect(keys)

    def _absorb(self, text: str, emit: Callable[[], None]) -> bool:
        """True when `text` is (part of) the title just placed; it is then not emitted."""
        expect = self._expect
        if expect is None:
            return False
        if len(text) > MAX_TITLE_LINE:
            self._release()
            return False
        joined = f"{expect.text} {text}".strip()
        found = title_keys(joined)
        if found & expect.keys:
            self._expect = None  # the held lines were the title too
            return True
        if len(expect.held) < 2 and any(w.startswith(f) for w in expect.keys for f in found):
            expect.text = joined
            expect.held.append(emit)  # `Chapter 3` above `Feedback loops`: wait and see
            return True
        self._release()
        return False

    def _release(self) -> None:
        expect, self._expect = self._expect, None
        for emit in expect.held if expect else []:
            emit()

    def _page_mark(self, el: Element) -> bool:
        if "pagebreak" not in attr(el, "type").split() and attr(el, "role") != "doc-pagebreak":
            return False
        label = attr(el, "title") or attr(el, "aria-label") or text_of(el)
        if _PAGE.match(label.strip()):
            self.page = int(label)
            self.max_page = max(self.max_page or 0, self.page)
        return True

    # --- leaves -------------------------------------------------------------------------

    def _leaf(self, node: ParsedNode) -> None:
        self._release()
        node.page_from = node.page_to = self.page
        if self._refs:
            node.meta["footnotes"] = [{"marker": n.marker, "text": n.text} for n in self._refs]
            self._refs = []
        self.events.append(node)

    def _flush(self) -> None:
        text = normalize_text("".join(self._parts))
        self._parts = []
        if not text:
            return
        leaf = paragraph_leaf(text)
        if leaf is not None and not self._absorb(text, lambda: self._leaf(leaf)):
            self._leaf(leaf)

    def _heading(self, el: Element) -> None:
        text = self._inline(el)
        if not text:
            return
        rank = int(local_name(el)[1])

        def emit() -> None:
            self._release()
            if self._base is None:  # before the first ToC entry: a title page line
                self._leaf(ParsedNode(NodeKind.PARAGRAPH, text=text))
                return
            self.events.append(Heading(level=self._base + 1, title=text, page=self.page))
            self._loose.append(_Loose(len(self.events) - 1, rank, self._group, self._base))

        if not self._absorb(text, emit):
            emit()

    def _code(self, el: Element) -> None:
        code = text_of(el).strip("\n")
        if not code.strip():
            return
        classes = " ".join(attr(e, "class") for e in el.iter() if local_name(e) in ("pre", "code"))
        language = m.group(1).lower() if (m := _LANGUAGE.search(classes)) else None
        self._leaf(ParsedNode(NodeKind.CODE, text=code, meta={
            "language": language or guess_language(code), "caption": None, "listing_no": None,
        }))  # fmt: skip

    def _list(self, el: Element) -> None:
        items = [t for li in children(el) if local_name(li) == "li" and (t := self._inline(li))]
        ordered = local_name(el) == "ol"
        if items:
            self._leaf(ParsedNode(NodeKind.LIST, text=list_text(items, ordered=ordered),
                                  meta={"items": items, "ordered": ordered}))  # fmt: skip

    def _definitions(self, el: Element) -> None:
        """`<dl>` → a list of `term — definition; definition` items."""
        entries: list[tuple[str, list[str]]] = []
        for child in children(el):
            text = self._inline(child)
            if not text:
                continue
            if local_name(child) == "dd" and entries:
                entries[-1][1].append(text)
            else:
                entries.append((text, []))
        items = [f"{term} — {'; '.join(defs)}" if defs else term for term, defs in entries]
        if items:
            self._leaf(ParsedNode(NodeKind.LIST, text=list_text(items, ordered=False),
                                  meta={"items": items, "ordered": False}))  # fmt: skip

    def _table(self, el: Element) -> None:
        header: list[str] = []
        rows: list[list[str]] = []
        caption: str | None = None
        for node in el.iter():
            tag = local_name(node)
            if tag == "caption":
                caption = self._inline(node) or None
            if tag != "tr":
                continue
            cells = [c for c in children(node) if local_name(c) in ("td", "th")]
            texts = [self._inline(c) for c in cells]
            parent = node.getparent()
            head = (parent is not None and local_name(parent) == "thead") or all(
                local_name(c) == "th" for c in cells
            )
            if head and not header and not rows:
                header = texts
            elif any(texts):
                rows.append(texts)
        if header or rows:
            self._leaf(ParsedNode(NodeKind.TABLE, text=table_text(header, rows),
                                  meta={"table": {"header": header, "rows": rows},
                                        "caption": caption}))  # fmt: skip

    def _quote(self, el: Element) -> None:
        if text := self._inline(el):
            self._leaf(ParsedNode(NodeKind.QUOTE, text=text))

    def _aside(self, el: Element) -> None:
        typed = f"{attr(el, 'type')} {attr(el, 'class')}".lower()
        if "pullquote" in typed:
            return  # repeats text from the page
        head = next((c for c in children(el) if local_name(c) in HEADINGS), None)
        label = self._inline(head) if head is not None else None
        text = self._inline(el, skip=head)
        if label is None and (labelled := aside_label(text)):
            label, text = labelled[0], labelled[1] or text
        if text:
            self._leaf(ParsedNode(NodeKind.ASIDE, text=text, meta={"label": label}))

    # --- figures ------------------------------------------------------------------------

    def _figure(self, el: Element) -> None:
        caption_el = next((c for c in el.iter() if local_name(c) == "figcaption"), None)
        image = next(
            (c for c in el.iter() if local_name(c) in IMAGES and self._source(c) is not None),
            None,
        )
        if image is None:
            self._children(el)  # a figure wrapping code, a table or a quote
            return
        caption = self._inline(caption_el) if caption_el is not None else None
        self._image_figure(image, caption=caption or None)

    def _image_figure(self, el: Element, *, caption: str | None) -> None:
        source = self._source(el)
        if source is None or source is _COVER:
            return
        alt = attr(el, "alt") or attr(el, "title") or None
        node = ParsedNode(NodeKind.FIGURE, text=caption or alt or "",
                          meta={"src": source.path, "alt": alt, "caption": caption,
                                "image_path": None})  # fmt: skip
        self._leaf(node)
        self.images[id(node)] = source

    def _source(self, el: Element) -> ImageSource | None:
        tag = local_name(el)
        if tag == "svg":
            inner = next((c for c in el.iter() if local_name(c) == "image"), None)
            if inner is not None:
                return self._source(inner)
            svg = etree.tostring(el)
            if b"xmlns=" not in svg[:200]:
                svg = svg.replace(b"<svg", f'<svg xmlns="{_SVG_NS}"'.encode(), 1)
            return ImageSource(svg=svg)
        media_type = attr(el, "type")
        if tag == "object" and media_type and not media_type.startswith("image/"):
            return None
        href = attr(el, "src") if tag == "img" else attr(el, "data") or attr(el, "href")
        path, _ = resolve(self._path, href) if href else ("", None)
        if not path:
            return None
        return _COVER if path == self.cover else ImageSource(path=path)

    def _standalone(self, el: Element) -> bool:
        """An image alone in its block is a figure; one inside running text is not."""
        block = el.getparent()
        while block is not None and local_name(block) not in BLOCKS:
            block = block.getparent()
        if block is None:
            return True
        own = text_of(el)  # an SVG's labels or an <object>'s fallback text
        return not text_of(block).replace(own, "", 1).strip()

"""HTML article → `ParsedDocument` (one chapter, `h1..h3` as sections).

trafilatura does the readability extraction (boilerplate, nav and comments dropped), but
its XML drops three things the block kinds need, so they are read from the raw HTML
first: `<figcaption>` text (by image `src`), `<code class="language-*">` (by code text)
and MathML (rewritten to `\\( \\)` / `\\[ \\]` TeX before extraction).
"""

import html as htmlib
import re
import xml.etree.ElementTree as ET

import trafilatura

from app.models.enums import NodeKind
from app.pipeline.parse.anchors import assign_anchors, normalize_text
from app.pipeline.parse.model import Event, Heading, ParsedDocument, ParsedNode, ParseError
from app.pipeline.parse.text import aside_label, guess_language, list_text, table_text
from app.pipeline.parse.tree import build_tree

_FLAGS = re.IGNORECASE | re.DOTALL
_TAG = re.compile(r"<[^>]+>")
_CODE = re.compile(r"<pre[^>]*>\s*<code([^>]*)>(.*?)</code>", _FLAGS)
_LANG = re.compile(r"\b(?:language|lang)-([\w+#-]+)", re.IGNORECASE)
_FIGURE = re.compile(r"<figure\b.*?</figure>", _FLAGS)
_IMG_SRC = re.compile(r"<img\b[^>]*\bsrc=[\"']([^\"']+)[\"']", _FLAGS)
_FIGCAPTION = re.compile(r"<figcaption[^>]*>(.*?)</figcaption>", _FLAGS)
_MATH = re.compile(r"<math\b([^>]*)>(.*?)</math>", _FLAGS)
_TEX_ANNOTATION = re.compile(r"<annotation[^>]*x-tex[^>]*>(.*?)</annotation>", _FLAGS)
_ALTTEXT = re.compile(r"\balttext=[\"']([^\"']*)[\"']", _FLAGS)
_DISPLAY = re.compile(r"^\s*(?:\\\[(.+)\\\]|\$\$(.+)\$\$)\s*$", re.DOTALL)
_YEAR = re.compile(r"\b(\d{4})\b")
_AUTHORS = re.compile(r";|,|\band\b")


def _plain(fragment: str) -> str:
    return htmlib.unescape(_TAG.sub("", fragment))


def _code_languages(raw: str) -> dict[str, str]:
    languages: dict[str, str] = {}
    for attrs, body in _CODE.findall(raw):
        if lang := _LANG.search(attrs):
            languages[normalize_text(_plain(body))] = lang.group(1).lower()
    return languages


def _figure_captions(raw: str) -> dict[str, str]:
    captions: dict[str, str] = {}
    for figure in _FIGURE.findall(raw):
        src, caption = _IMG_SRC.search(figure), _FIGCAPTION.search(figure)
        if src and caption:
            captions[htmlib.unescape(src.group(1))] = normalize_text(_plain(caption.group(1)))
    return captions


def _math_to_tex(raw: str) -> str:
    def replace(m: re.Match[str]) -> str:
        attrs, body = m.group(1), m.group(2)
        tex = _TEX_ANNOTATION.search(body) or _ALTTEXT.search(attrs)
        latex = htmlib.unescape(tex.group(1)) if tex else normalize_text(_plain(body))
        latex = htmlib.escape(latex.strip(), quote=False)
        if re.search(r"display=[\"']block", attrs, re.IGNORECASE):
            return f"<p>\\[{latex}\\]</p>"
        return f"\\({latex}\\)"

    return _MATH.sub(replace, raw)


def _text(el: ET.Element) -> str:
    return normalize_text("".join(el.itertext()))


class _Walker:
    def __init__(self, languages: dict[str, str], captions: dict[str, str], title: str) -> None:
        self.languages, self.captions, self.title = languages, captions, title
        self.events: list[Event] = []
        self.levels: list[int] = []

    def leaf(self, kind: NodeKind, text: str, **meta: object) -> None:
        self.events.append(ParsedNode(kind, text=text, meta=meta))

    def heading(self, el: ET.Element) -> None:
        text = _text(el)
        rank = int((el.get("rend") or "h2").lstrip("h") or 2)
        if not text or (rank == 1 and text.casefold() == self.title.casefold()):
            return
        self.levels.append(rank)
        self.events.append(Heading(level=rank, title=text))

    def walk(self, parent: ET.Element) -> None:
        for el in parent:
            tag = el.tag
            if tag == "head":
                self.heading(el)
            elif tag == "p":
                self.paragraph(_text(el))
            elif tag == "list":
                items = [_text(i) for i in el.iter("item") if _text(i)]
                ordered = el.get("rend") == "ol"
                if items:
                    self.leaf(NodeKind.LIST, list_text(items, ordered=ordered),
                              items=items, ordered=ordered)  # fmt: skip
            elif tag == "table":
                self.table(el)
            elif tag == "graphic":
                src = el.get("src") or ""
                caption = self.captions.get(src) or el.get("title") or el.get("alt") or None
                self.leaf(NodeKind.FIGURE, caption or "", src=src, alt=el.get("alt"),
                          caption=caption, image_path=None)  # fmt: skip
            elif tag == "code":
                code = "".join(el.itertext()).strip("\n")
                language = self.languages.get(normalize_text(code)) or guess_language(code)
                self.leaf(NodeKind.CODE, code, language=language, caption=None, listing_no=None)
            elif tag == "quote":
                self.leaf(NodeKind.QUOTE, _text(el))
            else:
                self.walk(el)

    def paragraph(self, text: str) -> None:
        if not text:
            return
        if m := _DISPLAY.match(text):
            latex = (m.group(1) or m.group(2)).strip()
            self.leaf(NodeKind.MATH, latex, inline=False, latex=latex, image_path=None)
        elif labelled := aside_label(text):
            self.leaf(NodeKind.ASIDE, labelled[1] or text, label=labelled[0])
        else:
            self.leaf(NodeKind.PARAGRAPH, text)

    def table(self, el: ET.Element) -> None:
        rows = [[_text(cell) for cell in row.iter("cell")] for row in el.iter("row")]
        rows = [r for r in rows if any(r)]
        if not rows:
            return
        head_row = el.find("row")
        has_head = head_row is not None and any(c.get("role") == "head" for c in head_row)
        header, body = (rows[0], rows[1:]) if has_head or len(rows) > 1 else ([], rows)
        self.leaf(NodeKind.TABLE, table_text(header, body),
                  table={"header": header, "rows": body}, caption=None)  # fmt: skip

    def events_with_levels(self) -> list[Event]:
        """One chapter; the shallowest heading rank present → section, deeper → subsection."""
        ranks = sorted(set(self.levels))
        out: list[Event] = [Heading(level=1, title=self.title)]
        for event in self.events:
            if isinstance(event, Heading):
                event.level = min(2 + ranks.index(event.level), 3)
            out.append(event)
        return out


def parse_html(source: bytes | str, *, url: str | None = None) -> ParsedDocument:
    raw = source.decode("utf-8", errors="replace") if isinstance(source, bytes) else source
    xml = trafilatura.extract(
        _math_to_tex(raw),
        url=url,
        output_format="xml",
        include_tables=True,
        include_images=True,
        include_formatting=True,
        include_comments=False,
        with_metadata=True,
    )
    if not xml:
        raise ParseError("no article content could be extracted")
    root = ET.fromstring(xml)  # noqa: S314 - trafilatura's own output, not untrusted XML
    title = normalize_text(root.get("title") or "") or "Article"
    walker = _Walker(_code_languages(raw), _figure_captions(raw), title)
    main = root.find("main")
    walker.walk(main if main is not None else root)
    year = _YEAR.search(root.get("date") or "")
    parsed = ParsedDocument(
        title=title if root.get("title") else None,
        authors=[a.strip() for a in _AUTHORS.split(root.get("author") or "") if a.strip()],
        year=int(year.group(1)) if year else None,
        tier=1,
        language=root.get("language"),
        children=build_tree(walker.events_with_levels()),
    )
    if not any(not n.kind.is_container for n in parsed.walk()):
        raise ParseError("no article content could be extracted")
    assign_anchors(parsed.children)
    return parsed

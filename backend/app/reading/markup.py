"""A `Reading` as HTML that PyMuPDF's Story can break into pages and link.

Layout: a cover page, a contents page grouped by part (with page numbers once the
first layout pass has measured them), then one section per piece, each on a new page.
Citations link to the chapter they come from; "See also" links point between parts.

Story's HTML subset is small: no flexbox or floats, no `text-transform` (small labels
are uppercased here), links need `a:link` to lose the default blue, and a table cell
with a fixed width never finishes laying out, so the contents is a plain two-column table.
"""

import html
from collections.abc import Callable, Mapping
from itertools import groupby
from typing import Any

from app.reading.model import Block, Piece, Reading
from app.services import render_markdown as md

Cite = Callable[[str], str | None]


def reading_html(reading: Reading, pages: Mapping[str, int] | None = None) -> str:
    """The whole reading. `pages` maps a piece id to its page, for the contents."""
    pieces = "".join(_piece(piece, reading.cite_target) for piece in reading.pieces)
    return f"<article>{_cover(reading)}{_contents(reading, pages or {})}{pieces}</article>"


def _cover(reading: Reading) -> str:
    byline = f'<p class="byline">{_esc(reading.byline)}</p>' if reading.byline else ""
    count = len(reading.pieces)
    summary = f"{count} part{'s' if count != 1 else ''}" if count else "Nothing approved yet"
    return (
        '<section id="cover">'
        f'<p class="kicker">{_label(reading.edition)}</p>'
        f"<h1>{_esc(reading.title)}</h1>{byline}<hr/>"
        f'<p class="deck">{_esc(reading.deck)}</p>'
        f'<p class="meta">{summary}</p></section>'
    )


def _contents(reading: Reading, pages: Mapping[str, int]) -> str:
    if not reading.pieces:
        return (
            '<section id="contents"><h2>Contents</h2>'
            '<p class="empty">Nothing approved to read yet. Approve a distillation or a '
            "summary and export again.</p></section>"
        )
    groups = []
    for group, members in groupby(reading.pieces, key=lambda piece: piece.group):
        rows = "".join(_contents_row(piece, pages.get(piece.id)) for piece in members)
        groups.append(f'<p class="group">{_label(group)}</p><table class="toc">{rows}</table>')
    return f'<section id="contents"><h2>Contents</h2>{"".join(groups)}</section>'


def _contents_row(piece: Piece, page: int | None) -> str:
    kicker = f'<span class="toc-kicker">{_label(piece.kicker)}</span><br/>' if piece.kicker else ""
    number = str(page) if page else "\u2013"  # en dash until measured
    return (
        f'<tr><td class="toc-title">{kicker}<a href="#{piece.id}">{_esc(piece.title)}</a></td>'
        f'<td class="toc-page"><a href="#{piece.id}">{number}</a></td></tr>'
    )


def _piece(piece: Piece, cite: Cite) -> str:
    kicker = f'<p class="kicker">{_label(piece.kicker)}</p>' if piece.kicker else ""
    deck = f'<p class="standfirst">{_esc(piece.deck)}</p>' if piece.deck else ""
    lead = ""
    if piece.lead:
        inner = "".join(_block(block, cite) for block in piece.lead)
        lead = f'<div class="bridge"><p class="tone">WHERE THIS SITS</p>{inner}</div>'
    notes = "".join(_block(block, cite) for block in piece.blocks)
    if lead and notes:
        notes = f'<p class="notes-rule">THE APPROVED NOTES</p>{notes}'
    return (
        f'<section class="piece" id="{piece.id}">{kicker}'
        f"<h2>{_esc(piece.title)}</h2>{deck}{lead}{notes}{_see(piece.see)}</section>"
    )


def _see(links: tuple[tuple[str, str], ...]) -> str:
    if not links:
        return ""
    anchors = " · ".join(f'<a href="#{pid}">{_esc(title)}</a>' for pid, title in links)
    return f'<p class="see"><span class="tone">SEE ALSO</span> {anchors}</p>'


def _esc(value: object) -> str:
    return html.escape(str(value), quote=True)


def _label(value: object) -> str:
    """A small-caps style label: escaped and uppercased."""
    return _esc(str(value).upper())


def _cites(anchors: Any, cite: Cite) -> str:
    """Source anchors as small superscripts, each linked to its chapter when printed."""
    found = [a for a in anchors or [] if isinstance(a, str)]
    if not found:
        return ""
    marks = []
    for anchor in found:
        target = cite(anchor)
        marks.append(f'<a href="#{target}">{_esc(anchor)}</a>' if target else _esc(anchor))
    return f'<sup class="cite">{", ".join(marks)}</sup>'


def _spans(spans: Any, cite: Cite) -> str:
    if not isinstance(spans, list):
        return ""
    return " ".join(_span(s, cite) for s in spans if isinstance(s, dict) and s.get("text"))


_MARKS = {"strong": "strong", "em": "em", "highlight": "mark", "code": "code"}


def _span(span: Block, cite: Cite) -> str:
    text = _esc(span.get("text", ""))
    if tag := _MARKS.get(str(span.get("mark"))):
        text = f"<{tag}>{text}</{tag}>"
    return text + _cites(span.get("cites"), cite)


def _heading(block: Block, cite: Cite) -> str:
    del cite
    level = min(max(int(block.get("level", 2)) + 1, 3), 4)
    return f"<h{level}>{_esc(block.get('text', ''))}</h{level}>"


def _items(tag: str) -> Callable[[Block, Cite], str]:
    def render(block: Block, cite: Cite) -> str:
        rows = "".join(f"<li>{_spans(item, cite)}</li>" for item in block.get("items") or [])
        return f"<{tag}>{rows}</{tag}>"

    return render


def _table(block: Block, cite: Cite) -> str:
    header = "".join(f"<th>{_esc(cell)}</th>" for cell in block.get("header") or [])
    rows = []
    for row in block.get("rows") or []:
        cells = "".join(
            f"<td>{_span(cell, cite) if isinstance(cell, dict) else _esc(cell)}</td>"
            for cell in row
        )
        rows.append(f"<tr>{cells}</tr>")
    head = f"<thead><tr>{header}</tr></thead>" if header else ""
    caption = f'<p class="caption">{_esc(block["caption"])}</p>' if block.get("caption") else ""
    return f"<table>{head}<tbody>{''.join(rows)}</tbody></table>{caption}"


def _chart(block: Block, cite: Cite) -> str:
    header, rows = md.chart_rows(block)
    cells = [[{"text": cell, "cites": []} for cell in row] for row in rows]
    title = str(block.get("title") or "Chart")
    table = _table({"header": header, "rows": cells, "caption": title}, cite)
    return table + _cites(block.get("cites"), cite)


def _diagram(block: Block, cite: Cite) -> str:
    del cite
    nodes = {
        n.get("id"): n.get("label", "") for n in block.get("nodes") or [] if isinstance(n, dict)
    }
    lines = []
    for edge in block.get("edges") or []:
        if not isinstance(edge, dict):
            continue
        label = f' <span class="edge">{_esc(edge["label"])}</span>' if edge.get("label") else ""
        lines.append(
            f"<li>{_esc(nodes.get(edge.get('from'), edge.get('from')))} → "
            f"{_esc(nodes.get(edge.get('to'), edge.get('to')))}{label}</li>"
        )
    if not lines:
        lines = [f"<li>{_esc(label)}</li>" for label in nodes.values()]
    title = f'<p class="tone">{_label(block["title"])}</p>' if block.get("title") else ""
    return f'<div class="diagram">{title}<ul>{"".join(lines)}</ul></div>'


def _callout(block: Block, cite: Cite) -> str:
    tone = str(block.get("tone") or "important")
    title = block.get("title") or tone
    return (
        f'<div class="callout {_esc(tone)}"><p class="tone">{_label(title)}</p>'
        f"<p>{_spans(block.get('spans'), cite)}</p></div>"
    )


def _code(block: Block, cite: Cite) -> str:
    del cite
    caption = f'<p class="caption">{_esc(block["caption"])}</p>' if block.get("caption") else ""
    return f"<pre>{_esc(block.get('text', ''))}</pre>{caption}"


def _math(block: Block, cite: Cite) -> str:
    meaning = _spans(block.get("meaning"), cite)
    follow = f"<p>{meaning}</p>" if meaning else ""
    return f'<p class="math">{_esc(block.get("latex", ""))}</p>{follow}'


def _quote(block: Block, cite: Cite) -> str:
    source = [str(block["attribution"])] if block.get("attribution") else []
    if block.get("page") is not None:
        source.append(f"p. {block['page']}")
    by = f'<p class="by">— {_esc(", ".join(source))}</p>' if source else ""
    text = _esc(block.get("text", ""))
    return f"<blockquote><p>{text}{_cites(block.get('cites'), cite)}</p>{by}</blockquote>"


def _definition(block: Block, cite: Cite) -> str:
    term = _esc(block.get("term", ""))
    return f'<p class="definition"><strong>{term}</strong> {_spans(block.get("spans"), cite)}</p>'


def _paragraph(block: Block, cite: Cite) -> str:
    return f"<p>{_spans(block.get('spans'), cite)}</p>"


_RENDERERS: dict[str, Callable[[Block, Cite], str]] = {
    "heading": _heading,
    "paragraph": _paragraph,
    "bullets": _items("ul"),
    "steps": _items("ol"),
    "table": _table,
    "chart": _chart,
    "diagram": _diagram,
    "callout": _callout,
    "code": _code,
    "math": _math,
    "quote": _quote,
    "definition": _definition,
}


def _block(block: Block, cite: Cite) -> str:
    renderer = _RENDERERS.get(str(block.get("type")))
    return renderer(block, cite) if renderer else ""

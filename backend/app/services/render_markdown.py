"""Render-contract blocks (`contracts/render-blocks.schema.json`) as GitHub-flavoured Markdown.

One function per block type, dispatched by `render_blocks`. Input is assumed to have
passed the contract's schema (gates enforce that before an artifact is stored), but
missing optional keys never raise. Citations become links to in-document anchors, so
`[ch03/p014](#ch03/p014)` resolves against the ids an export writes for every node.

Also: `body_blocks` flattens the non-`blocks` artifact bodies (brief sections, FAQ,
quiz, flashcards, takeaways) into blocks, and `markdown_table` / `fence` are shared
with the tree export.
"""

from collections.abc import Callable, Iterable, Sequence
from typing import Any

Block = dict[str, Any]

_MARKS = {"strong": ("**", "**"), "em": ("*", "*"), "highlight": ("<mark>", "</mark>")}
# GitHub alert kinds per callout tone; the tone itself is kept in the title line.
_ALERTS = {
    "important": "IMPORTANT",
    "remember": "NOTE",
    "antipattern": "WARNING",
    "insight": "TIP",
    "caution": "CAUTION",
    "contrast": "NOTE",
    "question": "NOTE",
}


# --- inline -----------------------------------------------------------------------


def cite_links(cites: Iterable[str]) -> str:
    """` <sup>[ch03/p014](#ch03/p014)</sup>`, or `""` without cites."""
    links = ", ".join(f"[{c}](#{c})" for c in cites)
    return f" <sup>{links}</sup>" if links else ""


def _code_span(text: str) -> str:
    ticks = "`" * (_longest_run(text, "`") + 1)
    pad = " " if text.startswith("`") or text.endswith("`") else ""
    return f"{ticks}{pad}{text}{pad}{ticks}"


def render_span(span: Block) -> str:
    text = str(span.get("text", ""))
    mark = span.get("mark")
    if mark == "code":
        text = _code_span(text)
    elif mark in _MARKS:
        opening, closing = _MARKS[mark]
        text = f"{opening}{text}{closing}"
    return text + cite_links(span.get("cites", []))


def render_spans(spans: Sequence[Block]) -> str:
    return " ".join(render_span(s) for s in spans)


# --- shared helpers ----------------------------------------------------------------


def _longest_run(text: str, char: str) -> int:
    longest = current = 0
    for c in text:
        current = current + 1 if c == char else 0
        longest = max(longest, current)
    return longest


def fence(text: str, language: str = "") -> str:
    """A fenced code block whose fence is longer than any backtick run inside `text`."""
    ticks = "`" * max(3, _longest_run(text, "`") + 1)
    return f"{ticks}{language}\n{text.rstrip(chr(10))}\n{ticks}"


def _cell(value: str) -> str:
    return value.replace("|", "\\|").replace("\r", "").replace("\n", "<br>")


def markdown_table(header: Sequence[str], rows: Sequence[Sequence[str]]) -> str:
    """A pipe table; short rows are padded so every row has the header's width."""
    width = max([len(header), *(len(r) for r in rows)]) if rows or header else 0
    head = [*header, *[""] * (width - len(header))]
    lines = [
        "| " + " | ".join(_cell(h) for h in head) + " |",
        "|" + "|".join(" --- " for _ in head) + "|",
    ]
    for row in rows:
        cells = [*row, *[""] * (width - len(row))]
        lines.append("| " + " | ".join(_cell(c) for c in cells) + " |")
    return "\n".join(lines)


def _quote_lines(text: str) -> str:
    return "\n".join(f"> {line}" if line else ">" for line in text.split("\n"))


def _mermaid_label(label: str) -> str:
    return label.replace('"', "#quot;").replace("\n", " ")


# --- blocks ------------------------------------------------------------------------


def _heading(block: Block) -> str:
    level = min(max(int(block.get("level", 2)), 1), 6)
    return f"{'#' * level} {block.get('text', '')}"


def _paragraph(block: Block) -> str:
    return render_spans(block.get("spans", []))


def _bullets(block: Block) -> str:
    return "\n".join(f"- {render_spans(item)}" for item in block.get("items", []))


def _steps(block: Block) -> str:
    return "\n".join(
        f"{n}. {render_spans(item)}" for n, item in enumerate(block.get("items", []), 1)
    )


def _table(block: Block) -> str:
    rows = [[render_span(cell) for cell in row] for row in block.get("rows", [])]
    table = markdown_table(block.get("header", []), rows)
    caption = block.get("caption")
    return f"*{caption}*\n\n{table}" if caption else table


def chart_rows(block: Block) -> tuple[list[str], list[list[str]]]:
    """A chart as a table: one column for x, one per series, one row per x value."""
    x = block.get("x", {})
    series = block.get("series", [])
    header = [str(x.get("label", "x")), *(str(s.get("name", "")) for s in series)]
    rows = []
    for i, x_value in enumerate(x.get("values", [])):
        values = [s.get("values", []) for s in series]
        cells = [_number(v[i]) if i < len(v) else "" for v in values]
        rows.append([_number(x_value), *cells])
    return header, rows


def _number(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def _chart(block: Block) -> str:
    header, rows = chart_rows(block)
    y_label = block.get("y", {}).get("label")
    title = block.get("title") or f"{block.get('kind', 'chart').capitalize()} chart"
    axes = f" (y: {y_label})" if y_label else ""
    confidence = f" · confidence: {block['confidence']}" if block.get("confidence") else ""
    caption = f"*{title}{axes}*{cite_links(block.get('cites', []))}{confidence}"
    return f"{caption}\n\n{markdown_table(header, rows)}"


def _diagram(block: Block) -> str:
    lines = [f"flowchart {block.get('direction', 'TD')}"]
    lines += [f'  {n["id"]}["{_mermaid_label(n["label"])}"]' for n in block.get("nodes", [])]
    for edge in block.get("edges", []):
        label = f'|"{_mermaid_label(edge["label"])}"|' if edge.get("label") else ""
        lines.append(f"  {edge['from']} -->{label} {edge['to']}")
    cites = cite_links(block.get("cites", []))
    return fence("\n".join(lines), "mermaid") + (f"\n\n*Diagram*{cites}" if cites else "")


def _callout(block: Block) -> str:
    tone = str(block.get("tone", "important"))
    title = f"{tone.capitalize()}: {block['title']}" if block.get("title") else tone.capitalize()
    body = f"[!{_ALERTS.get(tone, 'NOTE')}]\n**{title}**\n{render_spans(block.get('spans', []))}"
    return _quote_lines(body)


def _code(block: Block) -> str:
    code = fence(str(block.get("text", "")), str(block.get("language", "")))
    caption = block.get("caption")
    cites = cite_links(block.get("cites", []))
    head = f"*{caption}*{cites}\n\n" if caption else ""
    tail = f"\n\n*Source*{cites}" if cites and not caption else ""
    return f"{head}{code}{tail}"


def _math(block: Block) -> str:
    latex = str(block.get("latex", "")).strip()
    out = f"$$\n{latex}\n$${cite_links(block.get('cites', []))}"
    meaning = block.get("meaning")
    return f"{out}\n\n{render_spans(meaning)}" if meaning else out


def _quote(block: Block) -> str:
    source = [str(block["attribution"])] if block.get("attribution") else []
    if block.get("page") is not None:
        source.append(f"p. {block['page']}")
    by = f"\n\n— {', '.join(source)}" if source else ""
    return _quote_lines(f"{block.get('text', '')}{by}{cite_links(block.get('cites', []))}")


def _definition(block: Block) -> str:
    return f"**{block.get('term', '')}**: {render_spans(block.get('spans', []))}"


RENDERERS: dict[str, Callable[[Block], str]] = {
    "heading": _heading,
    "paragraph": _paragraph,
    "bullets": _bullets,
    "steps": _steps,
    "table": _table,
    "chart": _chart,
    "diagram": _diagram,
    "callout": _callout,
    "code": _code,
    "math": _math,
    "quote": _quote,
    "definition": _definition,
}


def render_block(block: Block) -> str:
    renderer = RENDERERS.get(str(block.get("type")))
    if renderer is None:  # outside the contract: say so instead of dropping content
        return f"<!-- unsupported block type: {block.get('type')!r} -->"
    return renderer(block)


def render_blocks(blocks: Iterable[Block]) -> str:
    """Blocks as Markdown, separated by blank lines."""
    return "\n\n".join(render_block(b) for b in blocks)


# --- artifact bodies -----------------------------------------------------------------


def body_blocks(body: dict[str, Any]) -> list[Block]:
    """Every renderable block in an artifact body, in reading order.

    Handles `{blocks}`, brief `{sections: [{title, blocks}]}`, a `takeaway` span, and the
    item-list bodies of FAQ (`question`/`answer`), quiz (`choices`/`explanation`) and
    flashcards (`front`/`back`).
    """
    blocks: list[Block] = list(body.get("blocks", []))
    for section in body.get("sections", []):
        if section.get("title"):
            blocks.append({"type": "heading", "level": 3, "text": section["title"]})
        blocks.extend(section.get("blocks", []))
    for item in body.get("items", []):
        blocks.extend(_item_blocks(item))
    if isinstance(body.get("takeaway"), dict):
        blocks.append({"type": "paragraph", "spans": [body["takeaway"]]})
    return blocks


def _item_blocks(item: dict[str, Any]) -> list[Block]:
    if "front" in item:
        return [{"type": "definition", "term": item["front"], "spans": item.get("back", [])}]
    out: list[Block] = [{"type": "heading", "level": 4, "text": item.get("question", "")}]
    choices = item.get("choices")
    if choices:
        answer = item.get("answer")
        spans: list[list[Block]] = [
            [{"text": f"{c} ✓" if i == answer else c, "cites": []}] for i, c in enumerate(choices)
        ]
        out.append({"type": "steps", "items": spans})
    for key in ("answer", "explanation"):
        if isinstance(item.get(key), list):
            out.append({"type": "paragraph", "spans": item[key]})
    return out

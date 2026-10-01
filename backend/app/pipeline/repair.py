"""Deterministic repair of render-block shape slips, applied before the hard gates.

Smaller models (the `explore` rung, or any tier moved to `haiku`) get the render contract
right in substance but slip on its nesting: a paragraph with a bare `text` instead of
`spans`, a bullet item that is one span instead of a list of spans, a table cell that is a
list of spans instead of one. The retry prompt names the fix, yet the same slip often comes
back, and the job fails with good content in hand.

Each repair here is unambiguous and keeps every word and cite; nothing is invented. The one
exception is a diagram label past the contract's limit: it is cut at a word boundary and
marked with "…" (a verbatim box of prose is not a node label, and the retry rarely counts
characters better than the first reply). What cannot be repaired this way is left alone for
the schema gate to reject as before, and all soft gates (grounding, compression, ...) still
run on the repaired output.
"""

import json
from functools import lru_cache
from typing import Any

from app.core.config import REPO_ROOT

RENDER_BLOCKS = REPO_ROOT / "contracts" / "render-blocks.schema.json"
_SPANS_BLOCKS = frozenset({"paragraph", "callout", "definition"})
_LIST_BLOCKS = frozenset({"bullets", "steps"})
_DROPPABLE = frozenset({"confidence"})  # carries no content; only chart/diagram allow it


@lru_cache(maxsize=1)
def _callout_tones() -> frozenset[str]:
    defs = json.loads(RENDER_BLOCKS.read_text(encoding="utf-8"))["$defs"]
    return frozenset(defs["callout"]["properties"]["tone"]["enum"])


@lru_cache(maxsize=1)
def _allowed_keys() -> dict[str, frozenset[str]]:
    """Block type → the properties the render contract allows on it."""
    defs = json.loads(RENDER_BLOCKS.read_text(encoding="utf-8"))["$defs"]
    return {
        name: frozenset(schema["properties"])
        for name, schema in defs.items()
        if isinstance(schema, dict) and "const" in schema.get("properties", {}).get("type", {})
    }


@lru_cache(maxsize=1)
def _label_limits() -> tuple[int, int]:
    """The render contract's max length for a diagram node label and an edge label."""
    diagram = json.loads(RENDER_BLOCKS.read_text(encoding="utf-8"))["$defs"]["diagram"]
    props = diagram["properties"]
    node = props["nodes"]["items"]["properties"]["label"]["maxLength"]
    edge = props["edges"]["items"]["properties"]["label"]["maxLength"]
    return node, edge


def _shortened(label: str, limit: int) -> str:
    """`label` cut to at most `limit` characters at a word boundary, ending in "…"."""
    head = label[: limit - 1]
    if " " in head.strip() and not label[limit - 1].isspace():
        head = head.rsplit(" ", 1)[0]
    return head.rstrip(" ,;:.-\u2013\u2014") + "…"  # also en and em dashes


def _shorten_labels(items: Any, limit: int) -> int:
    """Shorten every over-long `label` in a list of nodes or edges; returns how many."""
    count = 0
    for item in items if isinstance(items, list) else []:
        label = item.get("label") if isinstance(item, dict) else None
        if isinstance(label, str) and len(label) > limit:
            item["label"] = _shortened(label, limit)
            count += 1
    return count


def _span(text: str, cites: object = None) -> dict[str, Any]:
    return {"text": text, "cites": cites if isinstance(cites, list) else []}


def _merged(spans: list[Any]) -> dict[str, Any] | None:
    """One span from several (a table cell holds one): texts joined, cites unioned."""
    if not all(isinstance(s, dict) and isinstance(s.get("text"), str) for s in spans):
        return None
    cites = list(dict.fromkeys(c for s in spans for c in s.get("cites") or []))
    return _span(" ".join(s["text"] for s in spans), cites)


def _as_spans(item: Any) -> Any:
    """A list item should be a list of spans; accept one span, `{"spans": [...]}` or a string."""
    if isinstance(item, dict) and isinstance(item.get("text"), str):
        return [item]
    if isinstance(item, dict) and set(item) == {"spans"} and isinstance(item["spans"], list):
        return item["spans"]
    if isinstance(item, str) and item.strip():
        return [_span(item)]
    return item


def _header_text(label: Any) -> Any:
    """A column label is a string; accept one span or a list of spans."""
    if isinstance(label, list) and label:
        merged = _merged(label)
        return merged["text"] if merged is not None else label
    if isinstance(label, dict) and isinstance(label.get("text"), str):
        return label["text"]
    return label


def _as_cell(cell: Any) -> Any:
    """A table cell should be one span; accept a list of spans or a plain string."""
    if isinstance(cell, list) and cell:
        return _merged(cell) or cell
    if isinstance(cell, str):
        return _span(cell)
    return cell


_EDGE_ALIASES = {"source": "from", "target": "to"}  # the graph-library spelling of an edge


def _as_edge(edge: Any) -> Any:
    """A diagram edge is `{from, to}`; accept `{source, target}` when that is unambiguous."""
    if not isinstance(edge, dict) or any(v in edge for v in _EDGE_ALIASES.values()):
        return edge
    if not all(k in edge for k in _EDGE_ALIASES):
        return edge
    return {_EDGE_ALIASES.get(k, k): v for k, v in edge.items()}


def _push_block_cites(block: dict[str, Any], cites: list[Any]) -> None:
    """Cites set on a block whose contract keeps them on its spans (a `steps` or `bullets`
    block cited as a whole, like a `math` one): each span without cites of its own takes
    them. A heading has no spans, and a heading is not a claim, so its cites are dropped."""
    spans: list[Any] = list(block.get("spans") or [])
    for item in block.get("items") or []:
        spans.extend(item if isinstance(item, list) else [item])
    for span in spans:
        if isinstance(span, dict) and isinstance(span.get("text"), str) and not span.get("cites"):
            span["cites"] = list(cites)


def _repair_block(block: dict[str, Any], fixes: list[str]) -> None:
    kind = block["type"]
    if kind in _callout_tones() and kind not in _allowed_keys():
        block["type"], block["tone"] = kind = "callout", kind
        fixes.append(f"{block['tone']} → callout tone")
    if kind == "paragraph" and "spans" not in block and isinstance(block.get("items"), list):
        block["type"] = kind = "bullets"
        fixes.append("paragraph with items → bullets")
    spans = block.get("spans")
    if kind == "heading" and "text" not in block and isinstance(spans, list):
        merged = _merged(spans)
        if merged is not None:
            del block["spans"]
            block["text"] = merged["text"]  # a heading is a label, not a claim: no cites
            fixes.append("heading: spans → text")
    if kind in _SPANS_BLOCKS and "spans" not in block and isinstance(block.get("text"), str):
        block["spans"] = [_span(block.pop("text"), block.pop("cites", None))]
        fixes.append(f"{kind}: text → spans")
    if kind in _LIST_BLOCKS and "items" not in block and isinstance(block.get("spans"), list):
        block["items"] = [[s] for s in block.pop("spans")]
        fixes.append(f"{kind}: spans → one item each")
    if kind in _LIST_BLOCKS and isinstance(block.get("items"), list):
        items = [_as_spans(item) for item in block["items"]]
        if items != block["items"]:
            block["items"] = items
            fixes.append(f"{kind}: items → lists of spans")
    if kind == "table" and isinstance(block.get("rows"), list):
        rows = [[_as_cell(c) for c in r] if isinstance(r, list) else r for r in block["rows"]]
        if rows != block["rows"]:
            block["rows"] = rows
            fixes.append("table: cells → spans")
    if kind == "table" and isinstance(block.get("header"), list):
        # Column labels are plain strings; a cite on a label adds nothing the rows lack.
        header = [_header_text(h) for h in block["header"]]
        if header != block["header"]:
            block["header"] = header
            fixes.append("table: header spans → strings")
    if kind == "diagram" and isinstance(block.get("edges"), list):
        edges = [_as_edge(e) for e in block["edges"]]
        if edges != block["edges"]:
            block["edges"] = edges
            fixes.append("diagram: source/target → from/to")
    if kind == "diagram":
        node_limit, edge_limit = _label_limits()
        shortened = _shorten_labels(block.get("nodes"), node_limit)
        shortened += _shorten_labels(block.get("edges"), edge_limit)
        if shortened:
            fixes.append(f"diagram: {shortened} over-long label(s) shortened")
    allowed = _allowed_keys().get(kind)
    if allowed is not None and "cites" not in allowed and isinstance(block.get("cites"), list):
        _push_block_cites(block, block.pop("cites"))
        fixes.append(f"{kind}: block cites → its spans")
    for key in _DROPPABLE:
        if allowed is not None and key in block and key not in allowed:
            del block[key]
            fixes.append(f"{kind}: dropped {key}")


def _is_block(value: dict[str, Any]) -> bool:
    kind = value.get("type")
    return isinstance(kind, str) and (kind in _allowed_keys() or kind in _callout_tones())


def repair_blocks(output: Any) -> list[str]:
    """Repair every render block in `output` in place; returns what was fixed."""
    fixes: list[str] = []
    stack = [output]
    while stack:
        value = stack.pop()
        if isinstance(value, dict):
            if _is_block(value):
                _repair_block(value, fixes)
            stack.extend(value.values())
        elif isinstance(value, list):
            stack.extend(value)
    return fixes

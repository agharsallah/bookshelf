"""Deterministic repair of render-block shape slips, applied before the hard gates.

Smaller models (the `explore` rung, or any tier moved to `haiku`) get the render contract
right in substance but slip on its nesting: a paragraph with a bare `text` instead of
`spans`, a bullet item that is one span instead of a list of spans, a table cell that is a
list of spans instead of one. The retry prompt names the fix, yet the same slip often comes
back, and the job fails with good content in hand.

Each repair here is unambiguous and keeps every word and cite; nothing is invented. What
cannot be repaired this way is left alone for the schema gate to reject as before, and all
soft gates (grounding, compression, ...) still run on the repaired output.
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


def _as_cell(cell: Any) -> Any:
    """A table cell should be one span; accept a list of spans or a plain string."""
    if isinstance(cell, list) and cell:
        return _merged(cell) or cell
    if isinstance(cell, str):
        return _span(cell)
    return cell


def _repair_block(block: dict[str, Any], fixes: list[str]) -> None:
    kind = block["type"]
    if kind in _callout_tones() and kind not in _allowed_keys():
        block["type"], block["tone"] = kind = "callout", kind
        fixes.append(f"{block['tone']} → callout tone")
    if kind == "paragraph" and "spans" not in block and isinstance(block.get("items"), list):
        block["type"] = kind = "bullets"
        fixes.append("paragraph with items → bullets")
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
        header = [h["text"] if isinstance(h, dict) and isinstance(h.get("text"), str) else h
                  for h in block["header"]]  # fmt: skip
        if header != block["header"]:
            block["header"] = header
            fixes.append("table: header spans → strings")
    allowed = _allowed_keys().get(kind)
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

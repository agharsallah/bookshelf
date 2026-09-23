"""Walk artifact bodies generically, whatever the skill's output shape.

Per `skills/README.md`: any object with `text` + `cites` is a leaf span, and any `cites` /
`evidence` array names anchors. Link-concepts endpoints `{kind: node, ref: <anchor>}` name
anchors too. Everything here is shape-agnostic so new skills need no gate code.
"""

import re
from collections.abc import Iterator
from typing import Any

_WORD = re.compile(r"\w+", re.UNICODE)
_ANCHOR_LISTS = ("cites", "evidence")


def iter_objects(value: Any) -> Iterator[dict[str, Any]]:
    """Every JSON object in `value`, depth first, in document order."""
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from iter_objects(child)
    elif isinstance(value, list):
        for child in value:
            yield from iter_objects(child)


def leaf_spans(value: Any) -> list[dict[str, Any]]:
    return [
        obj
        for obj in iter_objects(value)
        if isinstance(obj.get("text"), str) and isinstance(obj.get("cites"), list)
    ]


def cited_anchors(value: Any) -> set[str]:
    """Every anchor the body points at: `cites`, `evidence`, and node endpoints."""
    anchors: set[str] = set()
    for obj in iter_objects(value):
        for key in _ANCHOR_LISTS:
            items = obj.get(key)
            if isinstance(items, list):
                anchors.update(item for item in items if isinstance(item, str))
        if obj.get("kind") == "node" and isinstance(obj.get("ref"), str):
            anchors.add(obj["ref"])
    return anchors


def count_words(text: str) -> int:
    return len(_WORD.findall(text))


def plain_text(value: Any) -> str:
    """The leaf spans' text joined with spaces: what a reader actually reads."""
    return " ".join(span["text"] for span in leaf_spans(value))

"""Walk artifact bodies generically, whatever the skill's output shape.

Per `skills/README.md`: any object with `text` + `cites` is a leaf span, and any `cites` /
`evidence` array names anchors. Link-concepts endpoints `{kind: node, ref: <anchor>}` name
anchors too. Everything here is shape-agnostic so new skills need no gate code.
"""

import re
from collections.abc import Iterator, Mapping
from typing import Any

_WORD = re.compile(r"\w+", re.UNICODE)
_CJK = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")
# Speech rate: ~250 Chinese characters take as long to say as ~150 English words.
_WORDS_PER_CJK_CHAR = 0.6
_ANCHOR_LISTS = ("cites", "evidence")
# Keys whose values are not read: addresses, markup, numbers (`read_text`).
UNREAD_KEYS = frozenset(
    {"cites", "image_url", "audio_url", "latex", "id", "type", "direction", "mark", "from", "to"}
)


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


def spoken_words(text: str) -> float:
    """How long `text` takes to say, in English-word equivalents: Chinese has no spaces,
    so each character counts as the share of a word it takes to speak."""
    cjk = len(_CJK.findall(text))
    return count_words(_CJK.sub(" ", text)) + cjk * _WORDS_PER_CJK_CHAR


def plain_text(value: Any) -> str:
    """The leaf spans' text joined with spaces: what a reader actually reads."""
    return " ".join(span["text"] for span in leaf_spans(value))


def read_text(value: Any) -> str:
    """Every word of a body a reader reads, spans or plain strings alike (a quiz's question
    and choices, a flip's front), addresses and markup left out (`UNREAD_KEYS`)."""
    if isinstance(value, str):
        return value
    if isinstance(value, Mapping):
        return " ".join(read_text(v) for k, v in value.items() if k not in UNREAD_KEYS)
    if isinstance(value, list):
        return " ".join(read_text(v) for v in value)
    return ""

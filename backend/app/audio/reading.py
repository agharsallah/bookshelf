"""A chapter read aloud: its own words as a one-reader script, the shape `app.audio.speech`
voices (`{title, speakers, sections: [{title, turns: [{speaker, text, cites}]}]}`).

Nothing is summarised or rewritten; the text is only made fit to hear:

- every heading is said, and starts a new part, so the player's parts follow the chapter;
- a part holds whole blocks up to about `WORDS_PER_PART` words, since the speech model
  voices a part in one pass and short passes keep its pace even (and its timeline exact);
  a block longer than that is split between sentences;
- a list's items are said one by one, an aside with its label ("Key takeaways."), a
  figure by its caption; tables, code and formulas are left out (they do not read aloud),
  and so are parts of the book marked `skip` (a bibliography, an index);
- what only the eye uses goes: note markers ("[22]"), emoji and invisible characters; a
  short line with no closing punctuation (a heading set as a paragraph) gets a full stop,
  so the voice pauses after it instead of running on into the next sentence;
- every turn cites the block it reads, so the reader can follow the voice passage by passage.
"""

import hashlib
import json
import re
import unicodedata
from collections.abc import Iterator, Mapping
from typing import Any

from app.models import Node
from app.models.enums import NodeKind
from app.services.tree import TreeItem

WORDS_PER_PART = 220
HEADING_WORDS = 10  # a paragraph this short without closing punctuation is a heading
READER: Mapping[str, str] = {"role": "reader", "persona": "reads the text as it is written"}

# Closing quotes and brackets (\u201d \u2019), bullets and dashes (\u2013 \u2014) of typeset text.
_CLOSERS = "\"'\u201d\u2019)\\]"
_SENTENCE_END = re.compile(rf"(?<=[.!?\u2026])\s+|(?<=[.!?\u2026][{_CLOSERS}])\s+")
_BULLET = re.compile(
    r"^\s*(?:[-*\u2022\u2023\u25aa\u2013\u2014]|\(?\d{1,3}[.)]|\(?[a-zA-Z][.)])\s+"
)
_SPACE = re.compile(r"\s+")
_NOTE_MARK = re.compile(r"\s*\[\d{1,3}(?:[,\u2013-]\s*\d{1,3})*\]")
# Emoji and pictographs (So), invisible marks (Cf: joiners, soft hyphens) and the emoji
# variation selectors, which are combining marks (Mn) like accents, so named by range.
_UNSPOKEN = frozenset({"So", "Cf", "Co", "Cs"})
_VARIATION_SELECTORS = re.compile("[\ufe00-\ufe0f\U000e0100-\U000e01ef]")
_ENDS_A_THOUGHT = re.compile(rf"[.!?\u2026:;][{_CLOSERS}]*$")


def _clean(text: str) -> str:
    """`text` as it is heard: no note markers or unspoken characters, spaces collapsed."""
    text = _VARIATION_SELECTORS.sub("", _NOTE_MARK.sub("", text))
    text = "".join(c for c in text if unicodedata.category(c) not in _UNSPOKEN)
    return _SPACE.sub(" ", text).strip()


def _sentence(text: str) -> str:
    """`text` ending in punctuation, so the voice pauses after it as a reader would."""
    text = _clean(text)
    return text if not text or _ENDS_A_THOUGHT.search(text) else f"{text}."


def _items(node: Node) -> list[str]:
    raw = node.meta.get("items")
    if isinstance(raw, list) and raw:
        return [str(item) for item in raw]
    return [_BULLET.sub("", line) for line in (node.text or "").splitlines()]


def spoken(node: Node) -> str:
    """What reading `node` aloud says: its words, fit to hear; empty when it is not read."""
    match node.kind:
        case NodeKind.PARAGRAPH | NodeKind.QUOTE:
            text = _clean(node.text or "")
            return _sentence(text) if len(text.split()) <= HEADING_WORDS else text
        case NodeKind.LIST:
            return " ".join(s for item in _items(node) if (s := _sentence(item)))
        case NodeKind.ASIDE:
            label = _sentence(str(node.meta.get("label") or "").capitalize())
            return _clean(f"{label} {node.text or ''}")
        case NodeKind.FIGURE:
            caption = node.meta.get("caption") or node.text
            return _sentence(str(caption)) if caption else ""
        case _:
            return ""  # tables, code and formulas; containers speak their heading instead


def pieces(text: str, budget: int = WORDS_PER_PART) -> list[str]:
    """`text` in runs of whole sentences of at most `budget` words (a longer sentence alone)."""
    runs: list[str] = []
    current: list[str] = []
    words = 0
    for sentence in _SENTENCE_END.split(text):
        count = len(sentence.split())
        if current and words + count > budget:
            runs.append(" ".join(current))
            current, words = [], 0
        current.append(sentence)
        words += count
    if current:
        runs.append(" ".join(current))
    return runs


def _readable(item: TreeItem) -> Iterator[TreeItem]:
    """`item` and its descendants in reading order, without subtrees marked `skip`."""
    if item.node.meta.get("skip"):
        return
    yield item
    for child in item.children:
        yield from _readable(child)


def chapter_script(unit: TreeItem, budget: int = WORDS_PER_PART) -> dict[str, Any]:
    """The script that reads `unit` (a chapter, part or section, with its blocks) aloud."""
    title = _clean(unit.node.heading or unit.node.anchor)
    sections: list[dict[str, Any]] = []
    part: dict[str, Any] | None = None
    words = 0

    def start(heading: str) -> dict[str, Any]:
        nonlocal words
        words = 0
        sections.append({"title": heading, "turns": []})
        return sections[-1]

    for item in _readable(unit):
        node = item.node
        if node.kind.is_container:
            heading = _clean(node.heading or "")
            part = start(heading or (part["title"] if part else title))
            if heading:
                part["turns"].append(_turn(_sentence(heading), node))
            continue
        for run in pieces(spoken(node), budget):
            if not run:
                continue
            count = len(run.split())
            if part is None or (words and words + count > budget):
                part = start(part["title"] if part else title)
            part["turns"].append(_turn(run, node))
            words += count
    return {
        "title": title,
        "speakers": [dict(READER)],
        "sections": [s for s in sections if s["turns"]],
    }


def _turn(text: str, node: Node) -> dict[str, Any]:
    return {"speaker": 1, "text": text, "cites": [node.anchor]}


def content_hash(script: Mapping[str, Any]) -> str:
    """Names the words a reading voices: a re-parse that changes them makes a new render."""
    payload = json.dumps(script, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


def word_count(script: Mapping[str, Any]) -> int:
    return sum(
        len(str(turn["text"]).split())
        for section in script.get("sections", [])
        for turn in section.get("turns", [])
    )

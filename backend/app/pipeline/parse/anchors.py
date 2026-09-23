"""Deterministic anchors (D4) and content hashes.

An anchor is the path of segments from the root: `ch03/s02/p014`. Each segment is a
prefix plus a sibling counter, numbered per prefix within the parent, so the same tree
always yields the same anchors and inserting a figure does not renumber paragraphs.

    part pt01 · chapter ch01 · front matter fm01 · section s01 · subsection ss01
    paragraph p001 · list l001 · table t001 · figure f001 · code c001 · math m001
    aside a001 · quote q001

Containers get 2 digits, leaves 3 (more if a parent overflows). Content before the first
chapter lives in a `fm01` container (kind `chapter`, `meta.front_matter = true`).
"""

import hashlib
import re
import unicodedata
from collections import Counter
from collections.abc import Iterable

from app.models.enums import NodeKind
from app.pipeline.parse.model import ParsedNode

ANCHOR_RE = re.compile(r"^[a-z]+[0-9]+(/[a-z]+[0-9]+)*$")  # contracts/render-blocks

_LEAF_PREFIX = {
    NodeKind.PARAGRAPH: "p",
    NodeKind.LIST: "l",
    NodeKind.TABLE: "t",
    NodeKind.FIGURE: "f",
    NodeKind.CODE: "c",
    NodeKind.MATH: "m",
    NodeKind.ASIDE: "a",
    NodeKind.QUOTE: "q",
}
_WS = re.compile(r"\s+")


def normalize_text(text: str) -> str:
    """NFKC, whitespace collapsed, trimmed: what hashing and matching compare."""
    return _WS.sub(" ", unicodedata.normalize("NFKC", text)).strip()


def content_hash(text: str | None) -> str:
    return hashlib.sha256(normalize_text(text or "").encode("utf-8")).hexdigest()


def node_hash(node: ParsedNode) -> str:
    """Leaves hash their text; containers their heading."""
    return content_hash(node.text if not node.kind.is_container else node.heading)


def _prefix(node: ParsedNode, parent: ParsedNode | None) -> str:
    if node.kind is NodeKind.PART:
        return "pt"
    if node.kind is NodeKind.CHAPTER:
        return "fm" if node.meta.get("front_matter") else "ch"
    if node.kind is NodeKind.SECTION:
        return "ss" if parent is not None and parent.kind is NodeKind.SECTION else "s"
    return _LEAF_PREFIX[node.kind]


def assign_anchors(roots: Iterable[ParsedNode]) -> None:
    """Set `anchor` on every node, in place."""
    _assign(list(roots), parent=None, base="")


def _assign(children: list[ParsedNode], parent: ParsedNode | None, base: str) -> None:
    counters: Counter[str] = Counter()
    for child in children:
        prefix = _prefix(child, parent)
        counters[prefix] += 1
        width = 2 if child.kind.is_container else 3
        child.anchor = f"{base}{prefix}{counters[prefix]:0{width}d}"
        _assign(child.children, parent=child, base=f"{child.anchor}/")

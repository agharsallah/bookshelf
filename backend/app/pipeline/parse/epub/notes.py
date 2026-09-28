"""Footnotes and endnotes: found before the walk, lifted out of the text flow.

A link is a note reference when it says so (`epub:type="noteref"`, `role="doc-noteref"`,
a `footnote`/`noteref` class), or when it is marker-like (`4`, `*`, `[12]`) and its
target sits inside something typed or classed as a foot/end note. The target's block
(`<aside>`, `<li>`, `<p>`, `<div>`) is the note: it is skipped by the walker and its text
is attached to the citing leaf as `meta.footnotes` — the shape the PDF parser uses.
"""

import re
from dataclasses import dataclass

from app.pipeline.parse.anchors import normalize_text
from app.pipeline.parse.dom import Element, attr, local_name, text_of
from app.pipeline.parse.epub.package import resolve

_NOTE_WORD = re.compile(r"foot|endnote|rearnote|noteref|(?:^|[\s_-])note(?:$|[\s_-])", re.I)
_MARKER = re.compile(r"^[\[(]?(?:\d{1,4}|[a-z]|[*†‡§¶#]+)[\])]?$", re.IGNORECASE)
_LEADING_MARKER = re.compile(r"^\s*[\[(]?(?:\d{1,4}|[*†‡§¶#]+)[\])]?[.:]?\s+")
_BACK_ARROW = re.compile(r"^[↩↑⤴⇡^]+$")
_NOTE_BLOCKS = frozenset({"aside", "li", "p", "div", "section", "dd", "td"})


@dataclass(slots=True)
class Note:
    marker: str
    text: str


def _typed(el: Element) -> str:
    return " ".join((attr(el, "type"), attr(el, "role"), attr(el, "class")))


def _is_note_container(el: Element) -> bool:
    node: Element | None = el
    while node is not None:
        if _NOTE_WORD.search(_typed(node)):
            return True
        node = node.getparent()
    return False


def _link_text(link: Element) -> str:
    return normalize_text(text_of(link))


def _note_block(target: Element) -> Element:
    node: Element | None = target
    while node is not None and local_name(node) not in _NOTE_BLOCKS:
        node = node.getparent()
    return node if node is not None else target


def _note_text(block: Element, ref_ids: set[str]) -> str:
    """The note's text, without its back-link and its leading marker."""
    parts: list[str] = []

    def walk(el: Element) -> None:
        if local_name(el) == "a":
            href = attr(el, "href")
            back = (
                href.rpartition("#")[2] in ref_ids
                or "back" in _typed(el).lower()
                or bool(_BACK_ARROW.match(_link_text(el)))
            )
            if back:
                if el.tail:
                    parts.append(el.tail)
                return
        if el.text:
            parts.append(el.text)
        for child in el:
            if isinstance(child.tag, str):
                walk(child)
            elif child.tail:
                parts.append(child.tail)
        if el is not block and el.tail:
            parts.append(el.tail)

    walk(block)
    return _LEADING_MARKER.sub("", normalize_text("".join(parts)), count=1)


class Notes:
    """Every note of the book, keyed by its target, plus the links that cite them."""

    def __init__(self, documents: dict[str, Element]) -> None:
        # Keyed by the elements themselves: holding them keeps lxml's proxies (and so their
        # identity) alive for the walk; `id()` of a transient proxy would not be stable.
        self.by_link: dict[Element, Note] = {}
        self.hidden: set[Element] = set()  # note blocks, skipped by the walker
        ids = {
            path: {key: el for el in root.iter() if (key := el.get("id") or el.get("name"))}
            for path, root in documents.items()
        }
        refs_by_target: dict[tuple[str, str], list[Element]] = {}
        for path, root in documents.items():
            for link in root.iter("a"):
                target_path, fragment = resolve(path, attr(link, "href"))
                target = ids.get(target_path, {}).get(fragment or "")
                if target is None or target_path not in documents:
                    continue
                typed = _typed(link)
                if "back" in typed.lower():
                    continue  # a note's link back to where it is cited
                explicit = bool(_NOTE_WORD.search(typed))
                marker_like = bool(_MARKER.match(_link_text(link)))
                if explicit or (marker_like and _is_note_container(target)):
                    refs_by_target.setdefault((target_path, fragment or ""), []).append(link)
        cites = {link for links in refs_by_target.values() for link in links}
        for (path, fragment), links in refs_by_target.items():
            if ids[path][fragment] in cites:
                continue  # these links point at a reference: they are a note's back-links
            block = _note_block(ids[path][fragment])
            if any(_note_block(link) is block for link in links):
                continue  # a "note" that contains its own reference is ordinary text
            ref_ids = {i for link in links if (i := link.get("id"))}
            text = _note_text(block, ref_ids)
            if not text:
                continue
            self.hidden.add(block)
            for link in links:
                marker = _link_text(link).strip("[]()") or "*"
                self.by_link[link] = Note(marker=marker, text=text)

    def cited(self, link: Element) -> Note | None:
        return self.by_link.get(link)

    def is_hidden(self, el: Element) -> bool:
        return el in self.hidden

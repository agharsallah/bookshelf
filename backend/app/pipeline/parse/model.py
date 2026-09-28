"""The parsed tree: what every parser (PDF, EPUB, HTML, Markdown) produces, before persistence.

Pure data, no database. `store.store_tree()` turns a `ParsedDocument` into `nodes` rows.

Pages are 1-based everywhere (`page_from`, `page_to`, `meta.page`), matching what a PDF
viewer shows and what `doc.get_toc()` returns.
"""

from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any

from app.models.enums import NodeKind

Bbox = tuple[float, float, float, float]


class ParseError(Exception):
    """The input cannot be parsed at all (unreadable file, no text, unsupported type)."""


@dataclass(slots=True)
class Crop:
    """A region to render to PNG once the node's anchor is known."""

    page: int  # 1-based
    bbox: Bbox


@dataclass(slots=True)
class ParsedNode:
    """One node of the tree. Containers carry `heading`; leaves carry `text`.

    `anchor` is filled by `anchors.assign_anchors()`; parsers leave it empty.
    `crop` is a parser-internal request (figure / display math) that never reaches the DB.
    """

    kind: NodeKind
    heading: str | None = None
    text: str | None = None
    page_from: int | None = None
    page_to: int | None = None
    meta: dict[str, Any] = field(default_factory=dict)
    children: list["ParsedNode"] = field(default_factory=list)
    anchor: str = ""
    crop: Crop | None = field(default=None, repr=False)

    def walk(self) -> Iterator["ParsedNode"]:
        """Pre-order: a node always comes before its descendants."""
        yield self
        for child in self.children:
            yield from child.walk()


@dataclass(slots=True)
class Heading:
    """A container boundary in a parser's flat event stream.

    `level`: 0 part, 1 chapter, 2 section, 3 subsection. `tree.build_tree()` nests them.
    """

    level: int
    title: str
    page: int | None = None
    meta: dict[str, Any] = field(default_factory=dict)


Event = Heading | ParsedNode


@dataclass(slots=True)
class ParsedDocument:
    title: str | None = None
    authors: list[str] = field(default_factory=list)
    year: int | None = None
    page_count: int | None = None
    tier: int = 1
    language: str | None = None
    children: list[ParsedNode] = field(default_factory=list)
    needs_review: bool = False
    warnings: list[str] = field(default_factory=list)

    def walk(self) -> Iterator[ParsedNode]:
        for child in self.children:
            yield from child.walk()

    def node_count(self) -> int:
        return sum(1 for _ in self.walk())

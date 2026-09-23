"""An in-memory view of one document's node tree, in reading order.

Selectors and the orchestrator both need "the leaves under this scope", "the sections of
this chapter", "the chapter this anchor lives in". Loading the tree once per job (a few
thousand rows for a long book) keeps those questions cheap and free of recursive SQL.
Containers marked `meta.skip` (bibliography, index) are invisible here, subtree and all.
"""

import uuid
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any

from sqlmodel import Session, col, select

from app.models import Document, Node
from app.models.enums import NodeKind

_BLOCK_META = ("table", "header", "rows", "caption", "language", "latex")


def _skipped(node: Node) -> bool:
    return node.kind.is_container and bool(node.meta.get("skip"))


@dataclass(slots=True)
class Tree:
    document: Document
    by_anchor: dict[str, Node] = field(default_factory=dict)
    children: dict[uuid.UUID | None, list[Node]] = field(default_factory=dict)
    by_id: dict[uuid.UUID, Node] = field(default_factory=dict)

    @classmethod
    def load(cls, session: Session, document: Document) -> "Tree":
        tree = cls(document=document)
        nodes = session.exec(
            select(Node).where(Node.document_id == document.id).order_by(col(Node.ordinal))
        ).all()
        for node in nodes:
            tree.by_anchor[node.anchor] = node
            tree.by_id[node.id] = node
            tree.children.setdefault(node.parent_id, []).append(node)
        return tree

    @property
    def anchors(self) -> frozenset[str]:
        return frozenset(self.by_anchor)

    def walk(self, root: Node | None = None) -> Iterator[Node]:
        """Descendants of `root` (the whole document when None), depth first."""
        for child in self.children.get(root.id if root else None, []):
            if _skipped(child):
                continue
            yield child
            yield from self.walk(child)

    def leaves(self, root: Node | None = None) -> list[Node]:
        if root is not None and not root.kind.is_container:
            return [root]
        return [n for n in self.walk(root) if not n.kind.is_container]

    def chapters(self) -> list[Node]:
        """Chapters with any text under them: the units distillation is organised by."""
        return [n for n in self.walk() if n.kind is NodeKind.CHAPTER and self.leaves(n)]

    def section_scopes(self, chapter: Node) -> list[Node]:
        """What `distil_section` runs over: the chapter's non-empty sections, or the
        chapter itself when it has none."""
        sections = [
            n
            for n in self.children.get(chapter.id, [])
            if n.kind is NodeKind.SECTION and not _skipped(n) and self.leaves(n)
        ]
        return sections or [chapter]

    def ancestors(self, node: Node) -> list[Node]:
        """Nearest first."""
        chain: list[Node] = []
        parent = self.by_id.get(node.parent_id) if node.parent_id else None
        while parent is not None:
            chain.append(parent)
            parent = self.by_id.get(parent.parent_id) if parent.parent_id else None
        return chain

    def enclosing(self, node: Node, kinds: frozenset[NodeKind]) -> Node | None:
        """`node` itself or its nearest ancestor of one of `kinds`."""
        return next((n for n in [node, *self.ancestors(node)] if n.kind in kinds), None)

    def chapter_of(self, node: Node) -> Node | None:
        return self.enclosing(node, frozenset({NodeKind.CHAPTER}))

    def is_visible(self, node: Node) -> bool:
        return not any(_skipped(n) for n in [node, *self.ancestors(node)])


def block(node: Node) -> dict[str, Any]:
    """The `block` shape of the input envelope (skills/README.md)."""
    return {
        "anchor": node.anchor,
        "kind": node.kind.value,
        "text": node.text,
        "page": node.page_from,
        "meta": {k: node.meta[k] for k in _BLOCK_META if k in node.meta},
    }


def document_envelope(document: Document) -> dict[str, Any]:
    return {
        "slug": document.slug,
        "title": document.title,
        "authors": list(document.authors),
        "year": document.year,
    }


def scope_envelope(tree: Tree, node: Node | None) -> dict[str, Any]:
    if node is None:
        doc = tree.document
        return {
            "anchor": None,
            "kind": "document",
            "heading": doc.title,
            "page_from": 1 if doc.page_count else None,
            "page_to": doc.page_count,
        }
    heading = node.heading
    if heading is None:  # a block: name it after the container it sits in
        heading = next((a.heading for a in tree.ancestors(node) if a.heading), None)
    return {
        "anchor": node.anchor,
        "kind": node.kind.value,
        "heading": heading,
        "page_from": node.page_from,
        "page_to": node.page_to,
    }

"""Nest a flat stream of headings and leaves into the container tree.

Every parser emits `Heading` / `ParsedNode` events in reading order; this module is the
single place that decides nesting, front matter, back matter and page ranges, so all
formats produce the same shape.
"""

from collections.abc import Iterable

from app.models.enums import NodeKind
from app.pipeline.parse.model import Event, Heading, ParsedNode
from app.pipeline.parse.text import is_back_matter

_KIND_BY_LEVEL = {0: NodeKind.PART, 1: NodeKind.CHAPTER}


def build_tree(events: Iterable[Event]) -> list[ParsedNode]:
    """Nest events into root containers.

    - A heading closes every open container at its level or deeper.
    - A section-level heading with no chapter open is promoted to a chapter.
    - Leaves before the first heading go into a `front matter` container (`fm01`).
    - Bibliography / index headings get `meta.skip = true`.
    """
    roots: list[ParsedNode] = []
    stack: list[tuple[int, ParsedNode]] = []
    front: ParsedNode | None = None

    for event in events:
        if isinstance(event, Heading):
            level = event.level
            while stack and stack[-1][0] >= level:
                stack.pop()
            if level >= 2 and not any(lvl <= 1 for lvl, _ in stack):
                level = 1
                while stack and stack[-1][0] >= level:
                    stack.pop()
            container = ParsedNode(
                kind=_KIND_BY_LEVEL.get(level, NodeKind.SECTION),
                heading=event.title,
                page_from=event.page,
                page_to=event.page,
                meta=dict(event.meta),
            )
            if is_back_matter(event.title):
                container.meta["skip"] = True
            (stack[-1][1].children if stack else roots).append(container)
            stack.append((level, container))
            continue
        if stack:
            stack[-1][1].children.append(event)
        else:
            if front is None:
                front = ParsedNode(
                    kind=NodeKind.CHAPTER, heading="Front matter", meta={"front_matter": True}
                )
                roots.append(front)
            front.children.append(event)

    for root in roots:
        _fill_page_ranges(root)
    return roots


def _fill_page_ranges(node: ParsedNode) -> None:
    """Containers span their heading page through their last descendant's page."""
    pages = [p for p in (node.page_from, node.page_to) if p is not None]
    for child in node.children:
        _fill_page_ranges(child)
        pages.extend(p for p in (child.page_from, child.page_to) if p is not None)
    if pages:
        node.page_from, node.page_to = min(pages), max(pages)

"""The document tree: outline, leaves in reading order, and one node's subtree.

Every read is a single query. Structure is rebuilt in memory from `parent_id` links
(`build_tree`), and reading order comes from a recursive CTE that carries each node's
path of sibling ordinals, so ordering never depends on how anchors happen to sort.
"""

import uuid
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field

from sqlalchemy import CTE, func
from sqlalchemy.dialects.postgresql import array
from sqlmodel import Session, col, select

from app.core.errors import NotFoundError
from app.models import Node
from app.services.documents import CONTAINER_KINDS, LEAF_KINDS
from app.services.sql import anchor_under

# Upper bound on the nodes one `GET /nodes/...` subtree returns.
SUBTREE_CAP = 2000


@dataclass(slots=True)
class TreeItem:
    """A node and its children, in sibling order."""

    node: Node
    children: list["TreeItem"] = field(default_factory=list)

    def walk(self) -> Iterable["TreeItem"]:
        """This item, then its descendants, in reading (pre-)order."""
        yield self
        for child in self.children:
            yield from child.walk()


def build_tree(nodes: Sequence[Node]) -> list[TreeItem]:
    """Assemble nodes into trees. Roots are nodes whose parent is absent from `nodes`.

    Children keep the order they appear in `nodes`, so pass them sorted by ordinal (or in
    reading order). Linear time; no per-node queries.
    """
    items = {node.id: TreeItem(node) for node in nodes}
    roots: list[TreeItem] = []
    for node in nodes:
        parent = items.get(node.parent_id) if node.parent_id is not None else None
        (parent.children if parent is not None else roots).append(items[node.id])
    for item in items.values():
        item.children.sort(key=lambda child: child.node.ordinal)
    roots.sort(key=lambda root: root.node.ordinal)
    return roots


def walk(roots: Iterable[TreeItem]) -> Iterable[TreeItem]:
    for root in roots:
        yield from root.walk()


def load_tree(
    session: Session, document_id: uuid.UUID, *, depth: int | None, include_blocks: bool
) -> list[TreeItem]:
    """The outline: containers only, or every node with `include_blocks`.

    `depth` counts levels from the shallowest node (1 = top level only); `None` = all.
    """
    query = select(Node).where(Node.document_id == document_id)
    if not include_blocks:
        query = query.where(col(Node.kind).in_(CONTAINER_KINDS))
    if depth is not None:
        top = select(func.min(Node.depth)).where(Node.document_id == document_id).scalar_subquery()
        query = query.where(Node.depth < top + depth)
    nodes = session.exec(query.order_by(col(Node.depth), col(Node.ordinal))).all()
    return build_tree(nodes)


def _reading_order(document_id: uuid.UUID, root_id: uuid.UUID | None = None) -> CTE:
    """Recursive CTE of `(id, path)`: path = sibling ordinals from the root down.

    Ordering by `path` is a pre-order walk, i.e. reading order. From the document's roots,
    or from `root_id` for a subtree.
    """
    start = select(col(Node.id), array([col(Node.ordinal)]).label("path")).where(
        Node.document_id == document_id
    )
    if root_id is None:
        start = start.where(col(Node.parent_id).is_(None))
    else:
        start = start.where(Node.id == root_id)
    tree = start.cte("reading_order", recursive=True)
    child = select(col(Node.id), func.array_append(tree.c.path, Node.ordinal)).join(
        tree, col(Node.parent_id) == tree.c.id
    )
    return tree.union_all(child)


def list_blocks(
    session: Session,
    document_id: uuid.UUID,
    *,
    anchor_prefix: str | None,
    limit: int,
    offset: int,
) -> tuple[list[Node], int]:
    """Leaves in reading order, optionally under `anchor_prefix` (segment-aware)."""
    order = _reading_order(document_id)
    base = select(Node).join(order, order.c.id == Node.id).where(col(Node.kind).in_(LEAF_KINDS))
    if anchor_prefix:
        base = base.where(anchor_under(col(Node.anchor), anchor_prefix))
    total = session.exec(select(func.count()).select_from(base.subquery())).one()
    rows = session.exec(base.order_by(order.c.path).offset(offset).limit(limit)).all()
    return list(rows), int(total)


def get_node(session: Session, document_id: uuid.UUID, anchor: str) -> Node:
    node = session.exec(
        select(Node).where(Node.document_id == document_id, Node.anchor == anchor)
    ).first()
    if node is None:
        raise NotFoundError(f"No node '{anchor}' in document {document_id}.")
    return node


def load_subtree(session: Session, node: Node, *, cap: int = SUBTREE_CAP) -> tuple[TreeItem, bool]:
    """`node` with its descendants (leaves included), capped at `cap` nodes.

    Truncation keeps a reading-order prefix, so the returned tree is always connected.
    Returns `(tree, truncated)`.
    """
    if not node.kind.is_container:
        return TreeItem(node), False
    order = _reading_order(node.document_id, node.id)
    rows = session.exec(
        select(Node).join(order, order.c.id == Node.id).order_by(order.c.path).limit(cap + 1)
    ).all()
    truncated = len(rows) > cap
    roots = build_tree(rows[:cap])
    return roots[0], truncated

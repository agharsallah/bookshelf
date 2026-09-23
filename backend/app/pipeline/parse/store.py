"""Persist a parsed tree: upsert `nodes` by `(document_id, anchor)`.

Re-parsing is incremental by construction: a surviving anchor keeps its row id (so
anything pointing at the row stays valid), a changed block gets its new text and
`content_hash` (which is what re-runs downstream stages), and a vanished anchor is
deleted. Notes reference anchors, not node rows, so they are never touched (D11).
"""

import uuid
from typing import Any

from sqlalchemy import or_, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlmodel import Session, SQLModel

from app.models import Document, Node
from app.pipeline.parse.anchors import ANCHOR_RE, node_hash
from app.pipeline.parse.model import ParsedDocument, ParsedNode

BATCH_SIZE = 1000  # rows per INSERT; 11 bound values each, well under Postgres' 65535
_UPDATED = (
    "parent_id", "kind", "ordinal", "depth", "heading", "text", "content_hash",
    "page_from", "page_to", "meta",
)  # fmt: skip
_NODES = SQLModel.metadata.tables[Node.__tablename__]


def _rows(
    document_id: uuid.UUID, parsed: ParsedDocument, existing: dict[str, uuid.UUID]
) -> list[dict[str, Any]]:
    """Pre-order rows, so a parent is always written no later than its children."""
    rows: list[dict[str, Any]] = []

    def visit(children: list[ParsedNode], parent_id: uuid.UUID | None, depth: int) -> None:
        for ordinal, node in enumerate(children):
            if not ANCHOR_RE.match(node.anchor):
                raise ValueError(f"invalid anchor {node.anchor!r}; run assign_anchors() first")
            node_id = existing.get(node.anchor) or uuid.uuid4()
            rows.append(
                {
                    "id": node_id,
                    "document_id": document_id,
                    "parent_id": parent_id,
                    "anchor": node.anchor,
                    "kind": node.kind,
                    "ordinal": ordinal,
                    "depth": depth,
                    "heading": node.heading if node.kind.is_container else None,
                    "text": None if node.kind.is_container else (node.text or ""),
                    "content_hash": node_hash(node),
                    "page_from": node.page_from,
                    "page_to": node.page_to,
                    "meta": node.meta,
                }
            )
            visit(node.children, node_id, depth + 1)

    visit(parsed.children, None, 0)
    return rows


def store_tree(session: Session, document: Document, parsed: ParsedDocument) -> int:
    """Upsert the tree for `document`; returns the number of nodes. Does not commit."""
    current = select(_NODES.c.anchor, _NODES.c.id).where(_NODES.c.document_id == document.id)
    existing: dict[str, uuid.UUID] = dict(session.execute(current).tuples().all())
    rows = _rows(document.id, parsed, existing)
    anchors = [row["anchor"] for row in rows]
    if len(set(anchors)) != len(anchors):
        raise ValueError("duplicate anchors in parsed tree")

    for start in range(0, len(rows), BATCH_SIZE):
        stmt = insert(_NODES).values(rows[start : start + BATCH_SIZE])
        changed = [_NODES.c[col].is_distinct_from(stmt.excluded[col]) for col in _UPDATED]
        session.execute(
            stmt.on_conflict_do_update(
                index_elements=[_NODES.c.document_id, _NODES.c.anchor],
                set_={col: stmt.excluded[col] for col in _UPDATED},
                where=or_(*changed),  # unchanged rows are not rewritten
            )
        )
    # After the upsert, so surviving rows already point at surviving parents and the
    # parent_id cascade can only reach descendants of vanished anchors.
    session.execute(
        text("delete from nodes where document_id = :doc and not (anchor = any(:anchors))"),
        {"doc": document.id, "anchors": anchors},
    )
    return len(rows)

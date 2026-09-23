"""Small SQL helpers shared by the query services."""

from typing import Any

from sqlalchemy import ColumnElement, or_


def escape_like(value: str) -> str:
    """Escape `%`, `_` and `\\` so user input matches literally inside a LIKE pattern."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def contains_pattern(value: str) -> str:
    return f"%{escape_like(value)}%"


def anchor_under(column: Any, prefix: str) -> ColumnElement[bool]:
    """`column` is `prefix` or a descendant of it, respecting segment boundaries.

    `ch03` matches `ch03` and `ch03/s01/p002`, never `ch030`. Served by the
    `nodes_anchor_prefix_idx` (text_pattern_ops) index.
    """
    prefix = prefix.rstrip("/")
    return or_(column == prefix, column.like(f"{escape_like(prefix)}/%", escape="\\"))

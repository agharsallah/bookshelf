"""Reading progress: one position per chapter, upserted as you read.

`anchor` always moves to the latest block reported (scrolling back moves your place
back); `progress` only ever grows, so a chapter you finished stays finished. The book's
"continue reading" is simply its most recently updated position.

A document can also be marked finished as a whole (`documents.finished_at`): by hand, or
by moving on to the next document of a collection. It stands in for the chapter positions
when they fall short (a short chapter whose last lines never crossed the reading line, front
matter nobody reads), and leaves them as they are.
"""

from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert
from sqlmodel import Session, col, select

from app.models import Document, Node, ReadingPosition
from app.models._columns import utcnow
from app.models.enums import NodeKind
from app.services.errors import InvalidInputError


@dataclass(frozen=True, slots=True)
class PositionInput:
    unit: str
    anchor: str
    progress: float


def list_positions(session: Session, document: Document) -> Sequence[ReadingPosition]:
    """Every chapter position of the document, most recently read first."""
    return session.exec(
        select(ReadingPosition)
        .where(ReadingPosition.document_id == document.id)
        .order_by(col(ReadingPosition.updated_at).desc(), col(ReadingPosition.unit))
    ).all()


def _check(session: Session, document: Document, data: PositionInput) -> None:
    """`unit` must be a container of the document and `anchor` that node or one below it."""
    if data.anchor != data.unit and not data.anchor.startswith(f"{data.unit}/"):
        raise InvalidInputError(f"{data.anchor} is not inside {data.unit}.", field="body.anchor")
    nodes = session.exec(
        select(Node.anchor, Node.kind).where(
            Node.document_id == document.id, col(Node.anchor).in_({data.unit, data.anchor})
        )
    ).all()
    kinds: dict[str, NodeKind] = {anchor: NodeKind(kind) for anchor, kind in nodes}
    unit_kind = kinds.get(data.unit)
    if unit_kind is None or not unit_kind.is_container:
        message = f"{data.unit} is not a chapter of this document."
        raise InvalidInputError(message, field="body.unit")
    if data.anchor not in kinds:
        message = f"{data.anchor} does not exist in this document."
        raise InvalidInputError(message, field="body.anchor")


def save_position(session: Session, document: Document, data: PositionInput) -> ReadingPosition:
    _check(session, document, data)
    table = ReadingPosition.__table__  # type: ignore[attr-defined]
    stmt = insert(table).values(
        document_id=document.id, unit=data.unit, anchor=data.anchor, progress=data.progress
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=[table.c.document_id, table.c.unit],
        set_={
            "anchor": stmt.excluded.anchor,
            "progress": func.greatest(table.c.progress, stmt.excluded.progress),
            "updated_at": func.now(),
        },
    )
    session.execute(stmt)
    session.commit()
    return session.exec(
        select(ReadingPosition)
        .where(ReadingPosition.document_id == document.id, ReadingPosition.unit == data.unit)
        .execution_options(populate_existing=True)
    ).one()


def set_finished(session: Session, document: Document, finished: bool) -> Document:
    """Mark the document finished (keeping the first time it was) or not. Commits."""
    if finished and document.finished_at is None:
        document.finished_at = utcnow()
    elif not finished:
        document.finished_at = None
    session.add(document)
    session.commit()
    session.refresh(document)
    return document

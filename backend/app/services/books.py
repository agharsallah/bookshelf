"""Book persistence logic, kept out of the route layer so it stays testable."""

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import String
from sqlmodel import Session, col, func, select

from app.core.errors import AppError, NotFoundError
from app.models.book import Book, ReadingStatus
from app.schemas.book import BookCreate, BookUpdate


def _apply_filters[StatementT](
    statement: StatementT,
    *,
    status: ReadingStatus | None,
    search: str | None,
    tag: str | None,
) -> StatementT:
    query: Any = statement
    if status is not None:
        query = query.where(col(Book.status) == status)
    if search:
        # Bound parameters, never string interpolation: no SQL injection surface.
        pattern = f"%{search.lower()}%"
        query = query.where(
            func.lower(col(Book.title)).like(pattern) | func.lower(col(Book.author)).like(pattern)
        )
    if tag:
        # JSON column: works on SQLite and Postgres without a dialect-specific operator.
        query = query.where(
            func.lower(func.cast(col(Book.tags), String)).like(f'%"{tag.lower()}"%')
        )
    return query  # type: ignore[no-any-return]


def list_books(
    session: Session,
    *,
    limit: int,
    offset: int,
    status: ReadingStatus | None = None,
    search: str | None = None,
    tag: str | None = None,
) -> tuple[list[Book], int]:
    """Return one page of books plus the total number of matches."""
    base = _apply_filters(select(Book), status=status, search=search, tag=tag)
    counter = _apply_filters(
        select(func.count()).select_from(Book), status=status, search=search, tag=tag
    )
    total = session.exec(counter).one()
    page = (
        base.order_by(col(Book.created_at).desc(), col(Book.id).desc()).offset(offset).limit(limit)
    )
    books = session.exec(page).all()
    return list(books), int(total)


def get_book(session: Session, book_id: int) -> Book:
    book = session.get(Book, book_id)
    if book is None:
        raise NotFoundError(f"Book {book_id} does not exist.")
    return book


def create_book(session: Session, payload: BookCreate) -> Book:
    data = payload.model_dump()
    data["source_url"] = str(data["source_url"]) if data["source_url"] else None
    book = Book(**data)
    session.add(book)
    session.commit()
    session.refresh(book)
    return book


def update_book(session: Session, book_id: int, payload: BookUpdate) -> Book:
    book = get_book(session, book_id)
    # `exclude_unset` is what makes this a PATCH: absent != null.
    changes = payload.model_dump(exclude_unset=True)
    if "source_url" in changes and changes["source_url"] is not None:
        changes["source_url"] = str(changes["source_url"])

    merged_start = changes.get("started_on", book.started_on)
    merged_finish = changes.get("finished_on", book.finished_on)
    if merged_start and merged_finish and merged_finish < merged_start:
        raise AppError(
            "finished_on cannot be earlier than started_on",
            details=[{"field": "finished_on", "message": "must not precede started_on"}],
        )

    for field, value in changes.items():
        setattr(book, field, value)
    book.updated_at = datetime.now(UTC)
    session.add(book)
    session.commit()
    session.refresh(book)
    return book


def delete_book(session: Session, book_id: int) -> None:
    book = get_book(session, book_id)
    session.delete(book)
    session.commit()

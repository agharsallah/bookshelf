"""Book endpoints.

Every route declares its `response_model`, status code, and failure responses, so the
OpenAPI schema is the contract rather than a rough sketch of one.

Docs: https://fastapi.tiangolo.com/tutorial/path-operation-configuration/
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query, status

from app.api.deps import LimitDep, OffsetDep, SessionDep
from app.core.security import require_api_key
from app.models.book import ReadingStatus
from app.schemas.book import BookCreate, BookPublic, BookUpdate
from app.schemas.common import ErrorResponse, Page
from app.services import books as service

router = APIRouter(
    prefix="/books",
    tags=["books"],
    responses={
        422: {"model": ErrorResponse, "description": "Request validation failed."},
        429: {"model": ErrorResponse, "description": "Rate limit exceeded."},
    },
)

# Writes go through the shared API key; reads stay open.
write_guard = Depends(require_api_key)

BookIdPath = Annotated[int, Path(ge=1, description="Book id.")]


@router.get(
    "",
    response_model=Page[BookPublic],
    summary="List books",
    description="Paginated, newest first. Filter by reading status, tag, or a title/author search.",
)
async def list_books(
    session: SessionDep,
    limit: LimitDep = 20,
    offset: OffsetDep = 0,
    status_filter: Annotated[
        ReadingStatus | None, Query(alias="status", description="Reading status filter.")
    ] = None,
    search: Annotated[
        str | None, Query(min_length=1, max_length=100, description="Title or author substring.")
    ] = None,
    tag: Annotated[str | None, Query(min_length=1, max_length=40, description="Exact tag.")] = None,
) -> Page[BookPublic]:
    items, total = service.list_books(
        session,
        limit=limit,
        offset=offset,
        status=status_filter,
        search=search,
        tag=tag,
    )
    return Page[BookPublic](
        items=[BookPublic.model_validate(book) for book in items],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/{book_id}",
    response_model=BookPublic,
    summary="Get one book",
    responses={404: {"model": ErrorResponse, "description": "No book with that id."}},
)
async def get_book(session: SessionDep, book_id: BookIdPath) -> BookPublic:
    return BookPublic.model_validate(service.get_book(session, book_id))


@router.post(
    "",
    response_model=BookPublic,
    status_code=status.HTTP_201_CREATED,
    summary="Add a book",
    dependencies=[write_guard],
    responses={401: {"model": ErrorResponse, "description": "Missing or invalid API key."}},
)
async def create_book(session: SessionDep, payload: BookCreate) -> BookPublic:
    return BookPublic.model_validate(service.create_book(session, payload))


@router.patch(
    "/{book_id}",
    response_model=BookPublic,
    summary="Update a book",
    description="Partial update: omitted fields keep their current value.",
    dependencies=[write_guard],
    responses={
        401: {"model": ErrorResponse, "description": "Missing or invalid API key."},
        404: {"model": ErrorResponse, "description": "No book with that id."},
    },
)
async def update_book(session: SessionDep, book_id: BookIdPath, payload: BookUpdate) -> BookPublic:
    return BookPublic.model_validate(service.update_book(session, book_id, payload))


@router.delete(
    "/{book_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove a book",
    dependencies=[write_guard],
    responses={
        401: {"model": ErrorResponse, "description": "Missing or invalid API key."},
        404: {"model": ErrorResponse, "description": "No book with that id."},
    },
)
async def delete_book(session: SessionDep, book_id: BookIdPath) -> None:
    service.delete_book(session, book_id)

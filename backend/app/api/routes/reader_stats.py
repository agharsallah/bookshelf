"""Reader statistics: how you read, listen, annotate and remember (`app.reader_stats`).
Read-only; computed on request."""

from typing import Annotated

from fastapi import APIRouter, Query

from app.api.deps import SessionDep
from app.api.routes.documents import DocumentRef
from app.reader_stats import service
from app.reader_stats.clock import zone
from app.schemas.reader_stats import BookReaderStats, LibraryReaderStats
from app.services.documents import get_document
from app.services.errors import InvalidInputError

router = APIRouter(tags=["reader stats"])

TzQuery = Annotated[
    str,
    Query(
        min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_+\-/]+$",
        description="IANA time zone that days and hours are counted in.",
    ),
]  # fmt: skip
DaysQuery = Annotated[
    int | None,
    Query(ge=1, le=3660, description="Only the last N days (today included); omit for all."),
]


def _window(tz: str, days: int | None) -> service.Window:
    try:
        zone(tz)
    except ValueError as exc:
        raise InvalidInputError(str(exc), field="query.tz") from exc
    return service.Window(tz=tz, days=days)


@router.get(
    "/reader-stats",
    response_model=LibraryReaderStats,
    summary="Reader statistics across the library",
    description=(
        "Time read, listened and studied; days, hours, sessions and streaks; every book's "
        "progress, pace and depth; chapters, most visited and annotated passages; notes, "
        "recall and review figures; the concepts you spent time with; and insights."
    ),
)
def get_reader_stats(
    session: SessionDep, tz: TzQuery = "UTC", days: DaysQuery = None
) -> LibraryReaderStats:
    return service.library_stats(session, _window(tz, days))


@router.get(
    "/documents/{ref}/reader-stats",
    response_model=BookReaderStats,
    summary="Reader statistics for one book",
    description="The library figures, narrowed to one book, with its row.",
)
def get_book_reader_stats(
    ref: DocumentRef, session: SessionDep, tz: TzQuery = "UTC", days: DaysQuery = None
) -> BookReaderStats:
    document = get_document(session, ref)
    return service.book_stats(session, document, _window(tz, days))

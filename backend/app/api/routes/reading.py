"""Reading progress: where you are in each chapter, and where to continue the book."""

from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi import Path as PathParam

from app.api.deps import SessionDep
from app.core.security import require_api_key
from app.schemas.reading import PositionUpdate, ReadingPositionPublic
from app.services import documents, reading

router = APIRouter(prefix="/documents", tags=["reading"])

DocumentRef = Annotated[
    str, PathParam(min_length=1, max_length=200, description="Document uuid or slug.")
]


@router.get(
    "/{ref}/reading",
    response_model=list[ReadingPositionPublic],
    summary="Get reading progress",
    description="One position per chapter opened in the reader, most recently read first: "
    "the first is where to continue the book.",
)
def list_positions(ref: DocumentRef, session: SessionDep) -> list[ReadingPositionPublic]:
    document = documents.get_document(session, ref)
    return [
        ReadingPositionPublic.model_validate(p) for p in reading.list_positions(session, document)
    ]


@router.put(
    "/{ref}/reading",
    response_model=ReadingPositionPublic,
    dependencies=[Depends(require_api_key)],
    summary="Save the reading position in a chapter",
    description="Upserts the chapter's position: `anchor` replaces the stored one, "
    "`progress` only raises it. `unit` must be a chapter of the document and `anchor` "
    "lie inside it (`422` otherwise).",
)
def save_position(
    ref: DocumentRef, body: PositionUpdate, session: SessionDep
) -> ReadingPositionPublic:
    document = documents.get_document(session, ref)
    data = reading.PositionInput(unit=body.unit, anchor=body.anchor, progress=body.progress)
    return ReadingPositionPublic.model_validate(reading.save_position(session, document, data))

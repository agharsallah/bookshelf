"""Reading progress: where you are in each chapter, and where to continue the book."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi import Path as PathParam

from app.api.deps import SessionDep
from app.core.security import require_api_key
from app.schemas.document import DocumentPublic
from app.schemas.reading import PositionUpdate, ReadingPositionPublic
from app.services import documents, reading

router = APIRouter(prefix="/documents", tags=["reading"])
shelf_router = APIRouter(prefix="/reading", tags=["reading"])

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


@shelf_router.get(
    "",
    response_model=dict[uuid.UUID, list[ReadingPositionPublic]],
    summary="Get reading progress for every document",
    description="Each document's positions, as `GET /documents/{ref}/reading` gives them, keyed "
    "by document id: one call for a whole shelf. A document never opened is absent.",
)
def list_all_positions(session: SessionDep) -> dict[uuid.UUID, list[ReadingPositionPublic]]:
    return {
        document_id: [ReadingPositionPublic.model_validate(p) for p in positions]
        for document_id, positions in reading.positions_by_document(session).items()
    }


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


@router.put(
    "/{ref}/reading/finished",
    response_model=DocumentPublic,
    dependencies=[Depends(require_api_key)],
    summary="Mark a document finished",
    description="Counts the document as read through, whatever its chapter positions say "
    "(they are left as they are). Keeps the first `finished_at` when it already is.",
)
def finish(ref: DocumentRef, session: SessionDep) -> DocumentPublic:
    document = reading.set_finished(session, documents.get_document(session, ref), True)
    return DocumentPublic.model_validate(document)


@router.delete(
    "/{ref}/reading/finished",
    response_model=DocumentPublic,
    dependencies=[Depends(require_api_key)],
    summary="Mark a document not finished",
    description="Clears `finished_at`: progress goes back to what the chapter positions say.",
)
def unfinish(ref: DocumentRef, session: SessionDep) -> DocumentPublic:
    document = reading.set_finished(session, documents.get_document(session, ref), False)
    return DocumentPublic.model_validate(document)

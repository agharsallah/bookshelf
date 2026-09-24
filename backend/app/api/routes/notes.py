"""Highlights and notes (§9 "Your notes"). `raw` is immutable (D11)."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status

from app.api.deps import LimitDep, OffsetDep, SessionDep
from app.core.security import require_api_key
from app.schemas.common import Page
from app.schemas.job import JobPublic
from app.schemas.node import ANCHOR_PATTERN
from app.schemas.note import NoteCreate, NoteCreated, NoteDetail, NotePublic, NoteUpdate
from app.services import notes

router = APIRouter(prefix="/notes", tags=["notes"])


@router.post(
    "",
    response_model=NoteCreated,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_api_key)],
    summary="Create a highlight or note",
    description=(
        "The anchor must exist in the document; `range` must lie within the node's text. "
        "With `raw`, queues a `structure_note` job whose artifact appears on `GET /notes`; "
        "without it the note is a plain highlight and `job` is null (no model call). "
        "With `artifact_id`, the note marks a passage of a chapter distillation or summary."
    ),
)
def create_note(body: NoteCreate, session: SessionDep) -> NoteCreated:
    data = notes.NoteInput(
        document_id=body.document_id,
        anchor=body.anchor,
        raw=body.raw,
        range=(body.range.start, body.range.end) if body.range else None,
        color=body.color,
        artifact_id=body.artifact_id,
        block=body.block,
        quote=body.quote,
    )
    note, job = notes.create_note(session, data)
    return NoteCreated.model_validate(
        {
            **NotePublic.model_validate(note).model_dump(),
            "job": JobPublic.model_validate(job) if job is not None else None,
        }
    )


@router.get("", response_model=Page[NoteDetail], summary="List notes with their structured version")
def list_notes(
    session: SessionDep,
    limit: LimitDep = 50,
    offset: OffsetDep = 0,
    document_id: uuid.UUID | None = None,
    anchor: Annotated[
        str | None,
        Query(max_length=200, pattern=ANCHOR_PATTERN, description="That node and below."),
    ] = None,
) -> Page[NoteDetail]:
    views, total = notes.list_notes(
        session, document_id=document_id, anchor=anchor, limit=limit, offset=offset
    )
    return Page(
        items=[NoteDetail.from_view(v) for v in views], total=total, limit=limit, offset=offset
    )


@router.get("/{note_id}", response_model=NoteDetail, summary="Get one note")
def get_note(note_id: uuid.UUID, session: SessionDep) -> NoteDetail:
    return NoteDetail.from_view(notes.view_note(session, notes.get_note(session, note_id)))


@router.patch(
    "/{note_id}",
    response_model=NoteDetail,
    dependencies=[Depends(require_api_key)],
    summary="Change a note's color, or give a plain highlight its words (once)",
    description=(
        "`color` may change any time (`null` clears it). `raw` is accepted only while the "
        "note has none (a plain highlight): it is stored for good and queues "
        "`structure_note`. A note that already has words answers `409` (D11)."
    ),
)
def update_note(note_id: uuid.UUID, body: NoteUpdate, session: SessionDep) -> NoteDetail:
    note = notes.get_note(session, note_id)
    if body.raw is not None:
        note, _ = notes.add_raw(session, note, body.raw)
    if "color" in body.model_fields_set:
        note = notes.set_color(session, note, body.color)
    return NoteDetail.from_view(notes.view_note(session, note))


@router.delete(
    "/{note_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_api_key)],
    summary="Delete a note and its structured versions",
)
def delete_note(note_id: uuid.UUID, session: SessionDep) -> Response:
    notes.delete_note(session, notes.get_note(session, note_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)

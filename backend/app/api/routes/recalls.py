"""Closed-book recall and predictions (§9 "Remembering it"). Your words are immutable (D11)."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from fastapi import Path as PathParam

from app.api.deps import SessionDep
from app.core.security import require_api_key
from app.schemas.job import JobPublic
from app.schemas.node import ANCHOR_PATTERN
from app.schemas.recall import RecallCreate, RecallCreated, RecallPublic
from app.services import documents, recalls
from app.services.recalls import RecallView

router = APIRouter(prefix="/documents", tags=["recalls"])

DocumentRef = Annotated[
    str, PathParam(min_length=1, max_length=200, description="Document uuid or slug.")
]


@router.post(
    "/{ref}/recalls",
    response_model=RecallCreated,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_api_key)],
    summary="Write a recall or a prediction",
    description="A `recall` (the chapter from memory) queues a `grade_recall` job; it needs "
    "the chapter's salience marks or distillation to grade against (`422` otherwise). A "
    "`prediction` (what you expect the chapter to argue) is kept for that grade to compare.",
)
def create_recall(ref: DocumentRef, body: RecallCreate, session: SessionDep) -> RecallCreated:
    document = documents.get_document(session, ref)
    recall, job = recalls.create_recall(session, document, body.unit, body.kind, body.raw)
    public = RecallPublic.from_view(RecallView(recall=recall, grade=None))
    return RecallCreated(
        **public.model_dump(), job=JobPublic.model_validate(job) if job is not None else None
    )


@router.get(
    "/{ref}/recalls",
    response_model=list[RecallPublic],
    summary="List recalls and predictions, with grades",
)
def list_recalls(
    ref: DocumentRef,
    session: SessionDep,
    unit: Annotated[
        str | None, Query(max_length=200, pattern=ANCHOR_PATTERN, description="One chapter.")
    ] = None,
) -> list[RecallPublic]:
    document = documents.get_document(session, ref)
    return [RecallPublic.from_view(v) for v in recalls.list_recalls(session, document, unit)]


@router.post(
    "/{ref}/recalls/{recall_id}/grade",
    response_model=JobPublic,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(require_api_key)],
    summary="Grade a recall again",
)
def grade_again(ref: DocumentRef, recall_id: uuid.UUID, session: SessionDep) -> JobPublic:
    document = documents.get_document(session, ref)
    return JobPublic.model_validate(recalls.grade_again(session, document, recall_id))

"""Recalls and predictions: written once, never edited (D11). Saving a recall queues its
`grade_recall` job in the same transaction; a prediction is only kept, for the grade of
the recall that follows it to compare against."""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass

from sqlmodel import Session, col, select

from app.core.errors import NotFoundError
from app.jobs.queue import JobSpec
from app.models import Document, Job, Node, Recall, RecallGrade
from app.models.enums import JobKind, NodeKind, RecallKind
from app.recall.ideas import key_ideas
from app.services.errors import InvalidInputError
from app.services.jobs import enqueue_or_live


@dataclass(frozen=True, slots=True)
class RecallView:
    recall: Recall
    grade: RecallGrade | None


def _check_unit(session: Session, document: Document, unit: str) -> None:
    kind = session.exec(
        select(Node.kind).where(Node.document_id == document.id, Node.anchor == unit)
    ).first()
    if kind is None or not NodeKind(kind).is_container:
        raise InvalidInputError(f"{unit} is not a chapter of this document.", field="body.unit")


def grade_job_spec(recall: Recall) -> JobSpec:
    return JobSpec(
        kind=JobKind.GRADE_RECALL,
        document_id=recall.document_id,
        anchor=recall.unit,
        input_hash=str(recall.id),
        payload={"recall_id": str(recall.id)},
        priority=20,  # someone is waiting on the result
    )


def create_recall(
    session: Session, document: Document, unit: str, kind: RecallKind, raw: str
) -> tuple[Recall, Job | None]:
    """Keep what you wrote; a recall also queues its grade (`422` when the chapter has no
    key ideas to grade against yet)."""
    _check_unit(session, document, unit)
    text = raw.strip()
    if not text:
        raise InvalidInputError("Write something first.", field="body.raw")
    if kind is RecallKind.RECALL and not key_ideas(session, document.id, unit):
        raise InvalidInputError(
            "This chapter has nothing to grade a recall against yet: "
            "mark what matters in it, or distil it, first.",
            field="body.unit",
        )
    recall = Recall(document_id=document.id, unit=unit, kind=kind, raw=text)
    session.add(recall)
    session.flush()
    if kind is RecallKind.PREDICTION:
        session.commit()
        session.refresh(recall)
        return recall, None
    job, _ = enqueue_or_live(session, grade_job_spec(recall))  # commits recall + job together
    session.refresh(recall)
    return recall, job


def get_recall(session: Session, document: Document, recall_id: uuid.UUID) -> Recall:
    recall = session.get(Recall, recall_id)
    if recall is None or recall.document_id != document.id:
        raise NotFoundError(f"Recall {recall_id} does not exist in {document.slug}.")
    return recall


def grade_again(session: Session, document: Document, recall_id: uuid.UUID) -> Job:
    recall = get_recall(session, document, recall_id)
    if recall.kind is not RecallKind.RECALL:
        raise InvalidInputError("A prediction is not graded on its own.", field="path.recall_id")
    job, _ = enqueue_or_live(session, grade_job_spec(recall))
    return job


def list_recalls(
    session: Session, document: Document, unit: str | None = None
) -> Sequence[RecallView]:
    """The document's recalls and predictions (one chapter's with `unit`), newest first."""
    query = select(Recall, RecallGrade).outerjoin(
        RecallGrade, col(RecallGrade.recall_id) == Recall.id
    )
    query = query.where(Recall.document_id == document.id)
    if unit is not None:
        query = query.where(Recall.unit == unit)
    rows = session.exec(query.order_by(col(Recall.created_at).desc())).all()
    return [RecallView(recall=r, grade=g) for r, g in rows]

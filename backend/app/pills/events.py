"""Pill events (docs/PILLS.md §6, L8): batched, idempotent, offline-friendly.

Ids are the client's, so a retried batch is a no-op: an id already recorded (or repeated
in the batch) counts as a duplicate, never an error. An event on a pill or review item
that no longer exists is ignored (an offline queue must not jam on it); an unknown
session id is dropped from the event.

Each newly recorded event, in time order, then does what it means:

* `seen` with a session moves its resume `position` past that pill;
* `save` queues the pill for review, `unsave` takes an unreviewed item back
  (`app.pills.reviews`); a wrong `answer` on a quiz or flip queues it too;
* an `answer` on a review pill is recorded only: the client rated it through
  `POST /reviews/{id}/rating`, and rating again would schedule it twice;
* the third `confusing` on pills of one `pill_set` (since its last verdict) sets that
  artifact to `needs_review`, and queues a harvest so its pills say so.
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from sqlalchemy.dialects.postgresql import insert
from sqlmodel import Session, SQLModel, col, func, select

from app.models import Artifact, ReviewItem
from app.models.enums import ArtifactType, PillEventKind, PillKind, Review
from app.models.pill import Pill, PillEvent, PillSession
from app.pills import reviews, triggers
from app.pipeline.artifacts import set_review
from app.schemas.pills import EventIn

CONFUSING_LIMIT = 3
MISSABLE = frozenset({PillKind.QUIZ, PillKind.FLIP})


@dataclass(frozen=True, slots=True)
class Ingested:
    accepted: int
    duplicates: int
    ignored: int


def _ids(session: Session, column: uuid.UUID, ids: set[uuid.UUID]) -> set[uuid.UUID]:
    """Which of `ids` exist in `column` (a model's `id`)."""
    if not ids:
        return set()
    return set(session.exec(select(col(column)).where(col(column).in_(list(ids)))).all())


def _record(
    session: Session, events: Sequence[EventIn], sessions: set[uuid.UUID]
) -> set[uuid.UUID]:
    """Insert the events; the ids actually inserted (a concurrent retry may win a race)."""
    table = SQLModel.metadata.tables[PillEvent.__tablename__]
    values = [
        {
            "id": e.id,
            "session_id": e.session_id if e.session_id in sessions else None,
            "pill_id": e.pill_id,
            "review_item_id": e.review_item_id,
            "kind": e.kind.value,
            "value": e.value,
            "at": e.at,
        }
        for e in events
    ]
    stmt = insert(table).values(values).on_conflict_do_nothing(index_elements=[table.c.id])
    return set(session.execute(stmt.returning(table.c.id)).scalars().all())


def _advance(session: Session, session_id: uuid.UUID, target: uuid.UUID) -> None:
    row = session.get(PillSession, session_id)
    if row is not None and target in row.served:
        row.position = max(row.position, row.served.index(target) + 1)
        session.add(row)


def _missed(event: EventIn, pill: Pill) -> bool:
    value: dict[str, Any] = event.value or {}
    return pill.kind in MISSABLE and value.get("correct") is False


def _apply(session: Session, event: EventIn, pill: Pill | None) -> uuid.UUID | None:
    """One event's effect; returns a pill_set artifact id to check for confusion."""
    target = event.pill_id or event.review_item_id
    if event.kind is PillEventKind.SEEN and event.session_id and target:
        _advance(session, event.session_id, target)
    if pill is None:  # a review pill: its item is rated through /reviews, never here
        return None
    if event.kind is PillEventKind.SAVE or (
        event.kind is PillEventKind.ANSWER and _missed(event, pill)
    ):
        reviews.save(session, pill)
    elif event.kind is PillEventKind.UNSAVE:
        reviews.unsave(session, pill)
    elif event.kind is PillEventKind.CONFUSING and pill.source_artifact_id is not None:
        return pill.source_artifact_id
    return None


def _confused(session: Session, artifact_id: uuid.UUID) -> None:
    artifact = session.get(Artifact, artifact_id)
    if artifact is None or artifact.type is not ArtifactType.PILL_SET:
        return
    if artifact.review in (Review.NEEDS_REVIEW, Review.REJECTED):
        return
    query = (
        select(func.count())
        .select_from(PillEvent)
        .join(Pill, col(Pill.id) == col(PillEvent.pill_id))
        .where(Pill.source_artifact_id == artifact_id, PillEvent.kind == PillEventKind.CONFUSING)
    )
    if artifact.reviewed_at is not None:
        query = query.where(col(PillEvent.at) > artifact.reviewed_at)
    if session.exec(query).one() >= CONFUSING_LIMIT:
        triggers.after_artifact(session, set_review(session, artifact, Review.NEEDS_REVIEW))


def ingest(session: Session, events: Sequence[EventIn]) -> Ingested:
    """Record a batch (module docstring). Commits."""
    unique: dict[uuid.UUID, EventIn] = {}
    for event in events:
        unique.setdefault(event.id, event)
    duplicates = len(events) - len(unique)
    known = _ids(session, PillEvent.id, set(unique))
    duplicates += len(known)
    fresh = [e for e in unique.values() if e.id not in known]
    pills = {
        p.id: p
        for p in session.exec(
            select(Pill).where(col(Pill.id).in_([e.pill_id for e in fresh if e.pill_id]))
        ).all()
    }
    items = _ids(session, ReviewItem.id, {e.review_item_id for e in fresh if e.review_item_id})
    valid = [
        e
        for e in fresh
        if (e.pill_id is None or e.pill_id in pills)
        and (e.review_item_id is None or e.review_item_id in items)
    ]
    ignored = len(fresh) - len(valid)
    sessions = _ids(session, PillSession.id, {e.session_id for e in valid if e.session_id})
    inserted = _record(session, valid, sessions) if valid else set()
    duplicates += len(valid) - len(inserted)
    confused: set[uuid.UUID] = set()
    for event in sorted((e for e in valid if e.id in inserted), key=lambda e: e.at):
        if event.session_id not in sessions:
            event = event.model_copy(update={"session_id": None})
        artifact_id = _apply(session, event, pills.get(event.pill_id) if event.pill_id else None)
        if artifact_id is not None:
            confused.add(artifact_id)
    session.commit()
    for artifact_id in sorted(confused):
        _confused(session, artifact_id)
    return Ingested(accepted=len(inserted), duplicates=duplicates, ignored=ignored)

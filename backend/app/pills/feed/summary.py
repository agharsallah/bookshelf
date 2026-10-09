"""The end card of a session (docs/PILLS.md §7 `finish`), from its events.

* `seen`: pills seen; `saved`: pills whose last save/unsave is a save;
* `answered` / `correct`: pills answered, and those whose last answer was right;
* `due_tomorrow`: review items due within a day, across the shelf (archived books wait);
* `minutes`: dwell time, or the pills' reading estimates without dwell events (at least 1
  once anything was seen);
* `next_read`: where to pick up reading: the latest reading position among the scope's
  unfinished documents (the next unit when that one is finished), else the unit of the
  first pill served.
"""

import uuid
from datetime import datetime, timedelta

from sqlmodel import Session, col, func, select

from app.models import Document, Node, ReadingPosition, ReviewItem
from app.models._columns import utcnow
from app.models.document import not_archived
from app.models.enums import PillEventKind
from app.models.pill import Pill, PillEvent, PillSession
from app.pills.feed.candidates import unit_of
from app.pills.feed.scope import resolve
from app.pills.feed.sessions import config_of, get_session
from app.pills.serialize import document_ref
from app.reader_stats.facts import FINISHED
from app.schemas.pills import NextRead, Summary

REVIEW_SECONDS = 20  # a review pill's reading estimate without dwell events


def _last_of(events: list[PillEvent], kinds: set[PillEventKind]) -> dict[uuid.UUID, PillEvent]:
    last: dict[uuid.UUID, PillEvent] = {}
    for event in events:  # in time order
        target = event.pill_id or event.review_item_id
        if event.kind in kinds and target is not None:
            last[target] = event
    return last


def _minutes(session: Session, events: list[PillEvent], seen: set[uuid.UUID]) -> int:
    ms = sum(
        int(v)
        for e in events
        if e.kind is PillEventKind.DWELL and isinstance(v := (e.value or {}).get("ms"), int | float)
    )
    seconds = ms / 1000
    if not seconds and seen:
        estimates = session.exec(
            select(Pill.id, Pill.est_seconds).where(col(Pill.id).in_(list(seen)))
        ).all()
        known = dict(estimates)
        seconds = sum(known.get(i, REVIEW_SECONDS) for i in seen)
    return max(round(seconds / 60), 1) if seen else 0


def _next_unit(session: Session, document_id: uuid.UUID, unit: str) -> Node | None:
    node = session.exec(
        select(Node).where(Node.document_id == document_id, Node.anchor == unit)
    ).first()
    if node is None:
        return None
    return session.exec(
        select(Node)
        .where(
            Node.document_id == document_id,
            Node.parent_id == node.parent_id,
            Node.kind == node.kind,
            col(Node.ordinal) > node.ordinal,
        )
        .order_by(col(Node.ordinal))
    ).first()


def _heading(session: Session, document_id: uuid.UUID, anchor: str) -> str | None:
    return session.exec(
        select(Node.heading).where(Node.document_id == document_id, Node.anchor == anchor)
    ).first()


def next_read(session: Session, row: PillSession) -> NextRead | None:
    scope = resolve(session, config_of(row))
    unfinished = [d for d, doc in scope.documents.items() if doc.finished_at is None]
    position = session.exec(
        select(ReadingPosition)
        .where(col(ReadingPosition.document_id).in_(unfinished))
        .order_by(col(ReadingPosition.updated_at).desc())
    ).first()
    if position is not None:
        document = scope.documents[position.document_id]
        if position.progress < FINISHED:
            title = _heading(session, document.id, position.unit)
            return NextRead(document=document_ref(document), anchor=position.anchor, title=title)
        following = _next_unit(session, document.id, position.unit)
        if following is not None:
            return NextRead(
                document=document_ref(document), anchor=following.anchor, title=following.heading
            )
    for served_id in row.served:
        target = session.get(Pill, served_id) or session.get(ReviewItem, served_id)
        if target is None:
            continue
        doc = session.get(Document, target.document_id)
        if doc is None:
            continue
        unit = unit_of(target.anchor)
        return NextRead(
            document=document_ref(doc), anchor=unit, title=_heading(session, doc.id, unit)
        )
    return None


def finish(session: Session, session_id: uuid.UUID, *, now: datetime | None = None) -> Summary:
    """Close the session (once; later calls just recount) and sum it up. Commits."""
    when = now or utcnow()
    row = get_session(session, session_id)
    if row.finished_at is None:
        row.finished_at = when
        session.add(row)
        session.commit()
    events = list(
        session.exec(
            select(PillEvent).where(PillEvent.session_id == row.id).order_by(col(PillEvent.at))
        ).all()
    )
    seen = set(_last_of(events, {PillEventKind.SEEN}))
    saves = _last_of(events, {PillEventKind.SAVE, PillEventKind.UNSAVE})
    answers = _last_of(events, {PillEventKind.ANSWER})
    due = session.exec(
        select(func.count())
        .select_from(ReviewItem)
        .join(Document, col(Document.id) == ReviewItem.document_id)
        .where(col(ReviewItem.due) <= when + timedelta(days=1), not_archived())
    ).one()
    return Summary(
        seen=len(seen),
        saved=sum(1 for e in saves.values() if e.kind is PillEventKind.SAVE),
        answered=len(answers),
        correct=sum(1 for e in answers.values() if (e.value or {}).get("correct") is True),
        due_tomorrow=int(due),
        minutes=_minutes(session, events, seen),
        next_read=next_read(session, row),
    )

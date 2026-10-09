"""Builders for the feed tests: pills, review items, reading positions and events, inserted
directly (no harvest), with bodies that satisfy the pill contract."""

import hashlib
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlmodel import Session

from app.models import Document, ReadingPosition, ReviewItem
from app.models.enums import PillEventKind, PillKind, ReviewSource
from app.models.pill import Pill, PillEvent
from app.pills.harvest.base import est_seconds

NOW = datetime(2026, 10, 6, 12, 0, tzinfo=UTC)


def spans(text: str, anchor: str) -> list[dict[str, Any]]:
    return [{"text": text, "cites": [anchor]}]


def body_for(kind: PillKind, anchor: str) -> dict[str, Any]:
    cite = f"{anchor}/p001"
    if kind is PillKind.QUIZ:
        return {
            "question": f"What does {anchor} say?",
            "choices": ["This", "That"],
            "answer": 0,
            "explanation": spans("Because the chapter says this.", cite),
        }
    if kind is PillKind.FLIP:
        return {"front": f"Front of {anchor}", "back": spans("The back of the card.", cite)}
    if kind is PillKind.QUOTE:
        return {"text": "A memorable line from the chapter."}
    return {"spans": spans(f"An idea from {anchor} worth keeping.", cite)}


def make_pill(
    session: Session,
    document: Document,
    anchor: str = "ch01",
    kind: PillKind = PillKind.INSIGHT,
    **overrides: Any,
) -> Pill:
    body = overrides.pop("body", None) or body_for(kind, anchor)
    key = uuid.uuid4().hex
    fields: dict[str, Any] = {
        "document_id": document.id,
        "anchor": anchor,
        "kind": kind,
        "body": body,
        "cites": [f"{anchor}/p001"],
        "est_seconds": est_seconds(kind, body),
        "origin": "harvest:chapter_distillation",
        "source_key": hashlib.sha256(key.encode()).hexdigest(),
    }
    pill = Pill(**(fields | overrides))
    session.add(pill)
    session.commit()
    session.refresh(pill)
    return pill


def make_review_item(
    session: Session, document: Document, anchor: str = "ch01/p001", **overrides: Any
) -> ReviewItem:
    fields: dict[str, Any] = {
        "document_id": document.id,
        "anchor": anchor,
        "source": ReviewSource.FLASHCARD,
        "source_key": uuid.uuid4().hex,
        "prompt": "What did the chapter claim?",
        "answer": spans("That queues grow without slack.", anchor),
        "card": {},
        "due": NOW,
    }
    item = ReviewItem(**(fields | overrides))
    session.add(item)
    session.commit()
    session.refresh(item)
    return item


def read(
    session: Session, document: Document, unit: str, progress: float, at: datetime = NOW
) -> None:
    session.add(
        ReadingPosition(
            document_id=document.id,
            unit=unit,
            anchor=f"{unit}/p001",
            progress=progress,
            updated_at=at,
        )
    )
    session.commit()


def make_event(
    session: Session,
    kind: PillEventKind,
    *,
    pill: Pill | None = None,
    at: datetime = NOW,
    **overrides: Any,
) -> PillEvent:
    event = PillEvent(
        id=uuid.uuid4(), kind=kind, pill_id=pill.id if pill else None, at=at, **overrides
    )
    session.add(event)
    session.commit()
    return event


def event(kind: str, target: Any, *, review: bool = False, **fields: Any) -> dict[str, Any]:
    """An event as a client posts it."""
    key = "review_item_id" if review else "pill_id"
    return {"id": str(uuid.uuid4()), key: str(target), "kind": kind, "at": NOW.isoformat()} | {
        k: (str(v) if isinstance(v, uuid.UUID) else v) for k, v in fields.items()
    }

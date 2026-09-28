"""Spaced retrieval reviews: what comes back, and when (FSRS, via py-fsrs).

A review item is a prompt, the cited answer it is checked against, and an FSRS card. Every
review is retrieval, not rereading: `due_items` never carries the answer, `reveal` only
hands it over for a typed attempt, and `rate` feeds your self-rating to the scheduler,
which sets the next `due`. Items come from graded recalls (the ideas you missed, the "why"
question) and from flashcards you mark; `add_item` never reschedules an item that exists.

The scheduler has no minute-scale learning steps: a book is not a language deck, and the
first return is a day away at the soonest ("Again"), a few days for "Good".
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from functools import cache
from typing import Any, cast

from fsrs import Card, Rating, Scheduler
from fsrs.card import CardDict
from sqlalchemy import delete, func
from sqlalchemy.dialects.postgresql import insert
from sqlmodel import Session, col, select

from app.core.errors import NotFoundError
from app.models import Artifact, Document, ReviewItem, ReviewLog
from app.models._columns import utcnow
from app.models.enums import ArtifactType, ReviewSource
from app.services.errors import InvalidInputError

# A flashcard mark is a self-rating: you knew it, or you are still learning it.
FLASHCARD_RATINGS = {"knew": Rating.Good, "learning": Rating.Again}


@cache
def scheduler() -> Scheduler:
    return Scheduler(learning_steps=(), relearning_steps=())


@dataclass(frozen=True, slots=True)
class ItemDraft:
    document_id: uuid.UUID
    anchor: str
    source: ReviewSource
    source_key: str
    prompt: str
    answer: list[dict[str, Any]]  # spans: [{text, cites}]


@dataclass(frozen=True, slots=True)
class DueItem:
    item: ReviewItem
    document: Document


def _new_card(due: datetime) -> dict[str, Any]:
    return dict(Card(due=due).to_dict())


def add_item(session: Session, draft: ItemDraft, *, due: datetime | None = None) -> ReviewItem:
    """Queue `draft` for review at `due` (now by default), unless its source already queued it:
    then the existing item, and its schedule, are kept. Does not commit."""
    when = due or utcnow()
    table = ReviewItem.__table__  # type: ignore[attr-defined]
    stmt = (
        insert(table)
        .values(
            id=uuid.uuid4(),
            document_id=draft.document_id,
            anchor=draft.anchor,
            source=draft.source.value,
            source_key=draft.source_key,
            prompt=draft.prompt[:2000],
            answer=draft.answer,
            card=_new_card(when),
            due=when,
        )
        .on_conflict_do_nothing(index_elements=[table.c.source, table.c.source_key])
    )
    session.execute(stmt)
    return session.exec(
        select(ReviewItem).where(
            ReviewItem.source == draft.source, ReviewItem.source_key == draft.source_key
        )
    ).one()


def due_items(
    session: Session, *, before: datetime | None = None, limit: int = 50
) -> tuple[list[DueItem], int]:
    """Items due by `before` (now) across every book, most overdue first, and how many."""
    cutoff = before or utcnow()
    due = col(ReviewItem.due) <= cutoff
    total = session.exec(select(func.count()).select_from(ReviewItem).where(due)).one()
    rows = session.exec(
        select(ReviewItem, Document)
        .join(Document, col(Document.id) == ReviewItem.document_id)
        .where(due)
        .order_by(col(ReviewItem.due), col(ReviewItem.created_at))
        .limit(limit)
    ).all()
    return [DueItem(item=i, document=d) for i, d in rows], total


def get_item(session: Session, item_id: uuid.UUID) -> ReviewItem:
    item = session.get(ReviewItem, item_id)
    if item is None:
        raise NotFoundError(f"Review item {item_id} does not exist.")
    return item


def _attempt(answer: str) -> str:
    text = answer.strip()
    if not text:
        raise InvalidInputError("Type your answer before revealing it.", field="body.answer")
    return text


def reveal(session: Session, item_id: uuid.UUID, answer: str) -> ReviewItem:
    """The item with its answer, once you have typed an attempt."""
    _attempt(answer)
    return get_item(session, item_id)


def _apply(
    session: Session, item: ReviewItem, rating: Rating, answer: str | None, now: datetime
) -> None:
    state = Card.from_dict(cast(CardDict, item.card))
    card, _ = scheduler().review_card(state, rating, review_datetime=now)
    item.card = dict(card.to_dict())
    item.due = card.due
    item.last_rating = int(rating)
    session.add(item)
    session.add(ReviewLog(item_id=item.id, rating=int(rating), answer=answer, reviewed_at=now))


def rate(
    session: Session, item_id: uuid.UUID, rating: int, answer: str, *, now: datetime | None = None
) -> ReviewItem:
    """Record a review (your typed answer and self-rating) and schedule the next one."""
    item = get_item(session, item_id)
    _apply(session, item, Rating(rating), _attempt(answer), now or utcnow())
    session.commit()
    session.refresh(item)
    return item


# --- Flashcards ---------------------------------------------------------------------------


def _deck(session: Session, artifact_id: uuid.UUID) -> Artifact:
    artifact = session.get(Artifact, artifact_id)
    if artifact is None or artifact.type is not ArtifactType.FLASHCARDS:
        raise NotFoundError(f"Flashcards {artifact_id} do not exist.")
    return artifact


def _card_key(artifact_id: uuid.UUID, index: int) -> str:
    return f"{artifact_id}:{index}"


def _deck_items(session: Session, artifact_id: uuid.UUID) -> Sequence[ReviewItem]:
    return session.exec(
        select(ReviewItem).where(
            ReviewItem.source == ReviewSource.FLASHCARD,
            col(ReviewItem.source_key).startswith(f"{artifact_id}:"),
        )
    ).all()


def flashcard_marks(session: Session, artifact_id: uuid.UUID) -> dict[int, str]:
    """Card index → your last mark on it (`knew` or `learning`)."""
    _deck(session, artifact_id)
    marks: dict[int, str] = {}
    for item in _deck_items(session, artifact_id):
        index = int(item.source_key.rsplit(":", 1)[1])
        if item.last_rating is not None:
            marks[index] = "learning" if item.last_rating == Rating.Again else "knew"
    return marks


def mark_flashcard(
    session: Session, artifact_id: uuid.UUID, index: int, mark: str, *, now: datetime | None = None
) -> ReviewItem:
    """Queue the card for review (once) and rate it by your mark."""
    artifact = _deck(session, artifact_id)
    items = artifact.body.get("items", [])
    if not 0 <= index < len(items):
        raise InvalidInputError(f"The deck has no card {index}.", field="path.index")
    card = items[index]
    back = list(card.get("back", []))
    cites = [c for span in back for c in span.get("cites", [])]
    anchor = cites[0] if cites else artifact.anchor
    if not anchor:
        raise InvalidInputError("This card cites no passage to review against.", field="path.index")
    when = now or utcnow()
    draft = ItemDraft(
        document_id=artifact.document_id,
        anchor=anchor,
        source=ReviewSource.FLASHCARD,
        source_key=_card_key(artifact.id, index),
        prompt=str(card.get("front", "")),
        answer=back,
    )
    item = add_item(session, draft, due=when)
    _apply(session, item, FLASHCARD_RATINGS[mark], None, when)
    session.commit()
    session.refresh(item)
    return item


def forget_flashcards(session: Session, artifact_id: uuid.UUID) -> None:
    """Drop every mark on the deck, and with them its cards' place in the review queue."""
    _deck(session, artifact_id)
    session.execute(
        delete(ReviewItem).where(
            col(ReviewItem.source) == ReviewSource.FLASHCARD,
            col(ReviewItem.source_key).startswith(f"{artifact_id}:"),
        )
    )
    session.commit()


def tomorrow(now: datetime | None = None) -> datetime:
    """When an idea you just missed first comes back: a day after you saw the answer."""
    return (now or utcnow()) + timedelta(days=1)

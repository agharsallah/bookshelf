"""Spaced retrieval reviews (§9 "Remembering it"): what is due, reveal, rate; flashcard marks."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from fastapi import Path as PathParam

from app.api.deps import SessionDep
from app.core.security import require_api_key
from app.schemas.review import (
    DueCard,
    DueCards,
    FlashcardMarks,
    MarkRequest,
    Rated,
    RatingRequest,
    Revealed,
    RevealRequest,
)
from app.services import reviews

router = APIRouter(prefix="/reviews", tags=["reviews"])

CardIndex = Annotated[int, PathParam(ge=0, le=999, description="The card's place in the deck.")]


@router.get(
    "/due",
    response_model=DueCards,
    summary="What is due for review",
    description="Review items due now across every book, most overdue first. Prompts only: "
    "an answer is revealed for a typed attempt.",
)
def list_due(session: SessionDep, limit: Annotated[int, Query(ge=1, le=200)] = 50) -> DueCards:
    items, total = reviews.due_items(session, limit=limit)
    return DueCards(items=[DueCard.from_due(d) for d in items], total=total)


@router.post(
    "/{item_id}/reveal",
    response_model=Revealed,
    dependencies=[Depends(require_api_key)],
    summary="Reveal an answer",
    description="The cited answer, for an attempt you typed (`422` when it is blank).",
)
def reveal(item_id: uuid.UUID, body: RevealRequest, session: SessionDep) -> Revealed:
    item = reviews.reveal(session, item_id, body.answer)
    return Revealed(id=item.id, anchor=item.anchor, answer=item.answer)


@router.post(
    "/{item_id}/rating",
    response_model=Rated,
    dependencies=[Depends(require_api_key)],
    summary="Rate a review",
    description="Logs your attempt and self-rating; FSRS sets when the item comes back.",
)
def rate(item_id: uuid.UUID, body: RatingRequest, session: SessionDep) -> Rated:
    item = reviews.rate(session, item_id, body.rating, body.answer)
    return Rated(id=item.id, due=item.due, last_rating=item.last_rating or body.rating)


@router.get(
    "/flashcards/{artifact_id}",
    response_model=FlashcardMarks,
    summary="Your marks on a flashcard deck",
)
def flashcard_marks(artifact_id: uuid.UUID, session: SessionDep) -> FlashcardMarks:
    return FlashcardMarks(marks=reviews.flashcard_marks(session, artifact_id))  # type: ignore[arg-type]


@router.put(
    "/flashcards/{artifact_id}/{index}",
    response_model=FlashcardMarks,
    dependencies=[Depends(require_api_key)],
    summary="Mark a flashcard",
    description="`knew` rates the card Good, `learning` rates it Again; either way the card "
    "joins the review queue.",
)
def mark_flashcard(
    artifact_id: uuid.UUID, index: CardIndex, body: MarkRequest, session: SessionDep
) -> FlashcardMarks:
    reviews.mark_flashcard(session, artifact_id, index, body.mark)
    return FlashcardMarks(marks=reviews.flashcard_marks(session, artifact_id))  # type: ignore[arg-type]


@router.delete(
    "/flashcards/{artifact_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_api_key)],
    summary="Forget your marks on a deck",
    description="Clears every mark, and takes the deck's cards out of the review queue.",
)
def forget_flashcards(artifact_id: uuid.UUID, session: SessionDep) -> Response:
    reviews.forget_flashcards(session, artifact_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)

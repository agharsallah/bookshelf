"""Spaced reviews: due cards carry no answer, the answer needs a typed attempt, and your
rating (or flashcard mark) is what schedules the next review."""

from datetime import timedelta

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.models import Document, ReviewItem, ReviewLog
from app.models._columns import utcnow
from app.models.enums import ArtifactType, ReviewSource
from app.services import reviews
from tests.api.factories import make_artifact, make_book
from tests.conftest import AUTH

ANSWER = [{"text": "Slack is capacity held in reserve.", "cites": ["ch01/s01/p001"]}]


def queue(session: Session, book: Document, key: str = "k1", **kw) -> ReviewItem:
    draft = reviews.ItemDraft(
        document_id=book.id,
        anchor="ch01/s01/p001",
        source=ReviewSource.RECALL,
        source_key=key,
        prompt="What is slack for?",
        answer=ANSWER,
    )
    item = reviews.add_item(session, draft, **kw)
    session.commit()
    return item


def test_due_lists_prompts_across_books_without_answers(client: TestClient, session: Session):
    first, second = make_book(session), make_book(session)
    queue(session, first, "a")
    queue(session, second, "b")
    queue(session, first, "later", due=utcnow() + timedelta(days=3))

    body = client.get("/api/v1/reviews/due").json()

    assert body["total"] == 2
    assert {c["document"]["slug"] for c in body["items"]} == {first.slug, second.slug}
    assert all("answer" not in c for c in body["items"])
    assert body["items"][0]["prompt"] == "What is slack for?"


def test_queueing_the_same_source_twice_keeps_its_schedule(session: Session):
    book = make_book(session)
    later = utcnow() + timedelta(days=9)
    queue(session, book, "same", due=later)
    again = queue(session, book, "same")

    assert again.due == later
    assert len(session.exec(select(ReviewItem)).all()) == 1


def test_the_answer_is_revealed_only_for_a_typed_attempt(client: TestClient, session: Session):
    item = queue(session, make_book(session))
    url = f"/api/v1/reviews/{item.id}/reveal"

    blank = client.post(url, json={"answer": "   "}, headers=AUTH)
    shown = client.post(url, json={"answer": "reserve capacity"}, headers=AUTH)

    assert blank.status_code == 422
    assert shown.status_code == 200
    assert shown.json()["answer"] == ANSWER


def test_rating_schedules_the_next_review_and_logs_the_attempt(
    client: TestClient, session: Session
):
    item = queue(session, make_book(session))
    good = client.post(
        f"/api/v1/reviews/{item.id}/rating", json={"rating": 3, "answer": "reserve"}, headers=AUTH
    )
    assert good.status_code == 200

    session.expire_all()
    reviewed = session.get(ReviewItem, item.id)
    assert reviewed is not None and reviewed.due > utcnow() + timedelta(days=1)
    assert reviewed.last_rating == 3
    assert client.get("/api/v1/reviews/due").json()["total"] == 0
    log = session.exec(select(ReviewLog)).one()
    assert (log.rating, log.answer) == (3, "reserve")


def test_again_brings_an_item_back_sooner_than_good(session: Session):
    book = make_book(session)
    again = queue(session, book, "again")
    good = queue(session, book, "good")
    now = utcnow()

    soon = reviews.rate(session, again.id, 1, "no idea", now=now).due
    later = reviews.rate(session, good.id, 3, "reserve", now=now).due

    assert now < soon < later


def test_flashcard_marks_live_on_the_server_and_join_the_queue(
    client: TestClient, session: Session
):
    book = make_book(session)
    deck = make_artifact(
        session,
        book,
        type=ArtifactType.FLASHCARDS,
        anchor="ch01",
        body={
            "items": [
                {"front": "What is slack?", "back": ANSWER},
                {"front": "Who wrote it?", "back": [{"text": "Okafor.", "cites": ["ch02/p001"]}]},
            ]
        },
    )
    url = f"/api/v1/reviews/flashcards/{deck.id}"

    client.put(f"{url}/0", json={"mark": "knew"}, headers=AUTH)
    marked = client.put(f"{url}/1", json={"mark": "learning"}, headers=AUTH)

    assert marked.json()["marks"] == {"0": "knew", "1": "learning"}
    assert client.get(url).json()["marks"] == {"0": "knew", "1": "learning"}
    items = {i.prompt: i for i in session.exec(select(ReviewItem)).all()}
    assert items["Who wrote it?"].anchor == "ch02/p001"
    assert items["Who wrote it?"].due < items["What is slack?"].due  # Again comes back first

    assert client.put(f"{url}/2", json={"mark": "knew"}, headers=AUTH).status_code == 422
    assert client.delete(url, headers=AUTH).status_code == 204
    assert client.get(url).json()["marks"] == {}


def test_marks_need_a_flashcard_deck(client: TestClient, session: Session):
    summary = make_artifact(session, make_book(session), anchor="ch01")
    response = client.get(f"/api/v1/reviews/flashcards/{summary.id}")
    assert response.status_code == 404

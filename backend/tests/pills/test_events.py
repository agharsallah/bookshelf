"""`POST /pills/events`: idempotent batches and what each event does to the review queue."""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.models import Document, Job, ReviewItem, ReviewLog
from app.models.enums import ArtifactType, JobKind, PillEventKind, PillKind, Review, ReviewSource
from app.models.pill import PillEvent
from app.pills import reviews
from tests.api.factories import make_artifact
from tests.conftest import AUTH
from tests.pills.feed_factories import event, make_event, make_pill, make_review_item

URL = "/api/v1/pills/events"


def post(client: TestClient, *events: dict[str, object]) -> dict[str, int]:
    response = client.post(URL, json={"events": list(events)}, headers=AUTH)
    assert response.status_code == 200, response.text
    return response.json()


def pill_items(session: Session) -> list[ReviewItem]:
    session.expire_all()
    return list(
        session.exec(select(ReviewItem).where(ReviewItem.source == ReviewSource.PILL)).all()
    )


def test_a_retried_batch_counts_duplicates(client: TestClient, session: Session, book: Document):
    pill = make_pill(session, book)
    seen = event("seen", pill.id)
    dwell = event("dwell", pill.id, value={"ms": 4000})

    assert post(client, seen, dwell, seen) == {"accepted": 2, "duplicates": 1, "ignored": 0}
    assert post(client, seen, dwell) == {"accepted": 0, "duplicates": 2, "ignored": 0}
    assert len(session.exec(select(PillEvent)).all()) == 2


def test_events_on_gone_pills_are_ignored_and_unknown_sessions_dropped(
    client: TestClient, session: Session, book: Document
):
    pill = make_pill(session, book)
    gone = event("seen", uuid.uuid4())
    orphan = event("seen", pill.id, session_id=uuid.uuid4())

    assert post(client, gone, orphan) == {"accepted": 1, "duplicates": 0, "ignored": 1}
    (stored,) = session.exec(select(PillEvent)).all()
    assert stored.session_id is None


def test_a_batch_is_capped_validated_and_needs_the_key(client: TestClient, book: Document):
    too_many = [event("seen", uuid.uuid4()) for _ in range(201)]
    assert client.post(URL, json={"events": too_many}, headers=AUTH).status_code == 422
    no_target = {"id": str(uuid.uuid4()), "kind": "seen", "at": "2026-10-06T12:00:00Z"}
    assert client.post(URL, json={"events": [no_target]}, headers=AUTH).status_code == 422
    assert client.post(URL, json={"events": [event("seen", uuid.uuid4())]}).status_code == 401


def test_save_queues_a_review_item_due_now_and_unsave_takes_it_back(
    client: TestClient, session: Session, book: Document
):
    flip = make_pill(session, book, "ch02", PillKind.FLIP, headline="Slack")
    post(client, event("save", flip.id))

    (item,) = pill_items(session)
    assert (item.source_key, item.document_id) == (flip.source_key, book.id)
    assert item.prompt == "Front of ch02"
    assert item.answer == [{"text": "The back of the card.", "cites": ["ch02/p001"]}]
    assert item.anchor == "ch02/p001"
    assert item.card and item.last_rating is None

    post(client, event("save", flip.id))  # a second save keeps the one item
    assert len(pill_items(session)) == 1
    post(client, event("unsave", flip.id))
    assert pill_items(session) == []


def test_unsave_keeps_an_item_you_have_reviewed(
    client: TestClient, session: Session, book: Document
):
    pill = make_pill(session, book)
    post(client, event("save", pill.id))
    (item,) = pill_items(session)
    item.last_rating = 3
    session.add(item)
    session.commit()

    post(client, event("unsave", pill.id))

    assert len(pill_items(session)) == 1


def test_a_wrong_quiz_answer_queues_the_pill_a_right_one_does_not(
    client: TestClient, session: Session, book: Document
):
    right = make_pill(session, book, "ch01", PillKind.QUIZ)
    wrong = make_pill(session, book, "ch02", PillKind.QUIZ)
    insight = make_pill(session, book, "ch03")

    post(
        client,
        event("answer", right.id, value={"correct": True, "choice": 0}),
        event("answer", wrong.id, value={"correct": False, "choice": 1}),
        event("answer", insight.id, value={"correct": False}),
    )

    (item,) = pill_items(session)
    assert item.source_key == wrong.source_key
    assert item.prompt == "What does ch02 say?"
    assert item.answer[0] == {"text": "This", "cites": ["ch02/p001"]}


def test_answering_a_review_pill_is_recorded_never_rated_again(
    client: TestClient, session: Session, book: Document
):
    item = make_review_item(session, book)
    due = item.due

    result = post(
        client, event("answer", item.id, review=True, value={"correct": False, "rating": 1})
    )

    assert result["accepted"] == 1
    session.expire_all()
    assert session.exec(select(ReviewLog)).all() == []
    fresh = session.get(ReviewItem, item.id)
    assert fresh is not None
    assert (fresh.due, fresh.last_rating) == (due, None)
    assert len(session.exec(select(ReviewItem)).all()) == 1


def test_three_confusing_marks_on_a_pill_set_send_it_back_for_review(
    client: TestClient, session: Session, book: Document
):
    pill_set = make_artifact(
        session, book, type=ArtifactType.PILL_SET, anchor="ch01", skill="make-pills"
    )
    pills = [
        make_pill(session, book, origin="skill:make-pills@1", source_artifact_id=pill_set.id)
        for _ in range(2)
    ]
    harvested = make_pill(session, book)

    post(client, event("confusing", pills[0].id), event("confusing", harvested.id))
    post(client, event("confusing", pills[1].id))
    session.refresh(pill_set)
    assert pill_set.review is Review.APPROVED

    post(client, event("confusing", pills[0].id))

    session.refresh(pill_set)
    assert pill_set.review is Review.NEEDS_REVIEW
    jobs = session.exec(select(Job).where(Job.kind == JobKind.HARVEST_PILLS)).all()
    assert [j.document_id for j in jobs] == [book.id]


def test_confusing_marks_before_the_last_verdict_do_not_count(
    session: Session, client: TestClient, book: Document
):
    pill_set = make_artifact(session, book, type=ArtifactType.PILL_SET, anchor="ch01")
    pill = make_pill(session, book, source_artifact_id=pill_set.id)
    for _ in range(3):
        make_event(session, PillEventKind.CONFUSING, pill=pill)
    pill_set.reviewed_at = pill_set.created_at.replace(year=2030)
    session.add(pill_set)
    session.commit()

    post(client, event("confusing", pill.id))

    session.refresh(pill_set)
    assert pill_set.review is Review.APPROVED


def test_review_cards_of_every_kind_have_a_prompt_and_cited_answer(
    session: Session, book: Document
):
    quote = make_pill(session, book, "ch01", PillKind.QUOTE, headline="On queues")
    definition = make_pill(
        session,
        book,
        "ch01",
        PillKind.DEFINITION,
        body={"term": "slack", "spans": [{"text": "Spare capacity.", "cites": ["ch01/p001"]}]},
    )
    insight = make_pill(session, book, "ch01")

    cards = {p.kind: reviews.draft_for(p) for p in (quote, definition, insight)}

    assert cards[PillKind.QUOTE] is not None
    assert cards[PillKind.QUOTE].prompt == "On queues"
    assert cards[PillKind.QUOTE].answer == [
        {"text": "A memorable line from the chapter.", "cites": ["ch01/p001"]}
    ]
    assert cards[PillKind.DEFINITION] is not None
    assert cards[PillKind.DEFINITION].prompt == "What is slack?"
    assert cards[PillKind.INSIGHT] is not None
    assert cards[PillKind.INSIGHT].prompt == "An idea from ch01 worth keeping."

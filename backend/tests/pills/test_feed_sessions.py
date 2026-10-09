"""Feed sessions (`app.pills.feed.sessions`): seeded pages, cursors, resume, done."""

import uuid

import pytest
from sqlmodel import Session

from app.models import Document
from app.models.enums import PillEventKind, PillKind
from app.models.pill import Pill, PillSession
from app.pills import events
from app.pills.contract import PillOut
from app.pills.feed import sessions
from app.pills.feed.config import FeedConfig
from app.schemas.pills import EventIn
from app.services.errors import InvalidInputError
from tests.pills.feed_factories import NOW, make_pill, make_review_item, read

EXPLORE = FeedConfig.model_validate({"mode": "explore", "length": 20})


def shelf(session: Session, book: Document, n: int = 25) -> list[Pill]:
    """`n` pills over ch01..ch06, every third a quiz."""
    return [
        make_pill(
            session, book, f"ch0{i % 6 + 1}", PillKind.QUIZ if i % 3 == 0 else PillKind.INSIGHT
        )
        for i in range(n)
    ]


def ids(page: sessions.Page) -> list[str]:
    return [str(p.id) for p in page.pills]


def see(session: Session, row: PillSession, pill: PillOut) -> None:
    """A `seen` event in the session, as the client sends it."""
    event = EventIn(
        id=uuid.uuid4(), session_id=row.id, pill_id=pill.id, kind=PillEventKind.SEEN, at=NOW
    )
    events.ingest(session, [event])


def stored(session: Session, row: PillSession) -> PillSession:
    session.expire_all()
    found = session.get(PillSession, row.id)
    assert found is not None
    return found


def test_a_session_serves_pages_until_its_length(session: Session, book: Document):
    shelf(session, book)
    row, first = sessions.create(session, EXPLORE, seed=3, now=NOW)
    second = sessions.page(session, row.id, cursor=first.next_cursor, now=NOW)

    assert (len(first.pills), first.next_cursor, first.done) == (10, "10", False)
    assert (len(second.pills), second.next_cursor, second.done) == (10, None, True)
    assert [str(i) for i in stored(session, row).served] == ids(first) + ids(second)


def test_a_cursor_replays_the_same_page(session: Session, book: Document):
    shelf(session, book)
    row, first = sessions.create(session, EXPLORE, seed=3, now=NOW)
    assert ids(sessions.page(session, row.id, cursor="0", now=NOW)) == ids(first)


def test_the_seed_fixes_the_order(session: Session, book: Document):
    shelf(session, book)
    _, a = sessions.create(session, EXPLORE, seed=11, now=NOW)
    _, b = sessions.create(session, EXPLORE, seed=11, now=NOW)
    assert ids(a) == ids(b)


def test_without_a_cursor_a_session_resumes_after_what_was_seen(session: Session, book: Document):
    shelf(session, book)
    row, first = sessions.create(session, EXPLORE, seed=3, now=NOW)
    for pill in first.pills[:3]:
        see(session, row, pill)

    resumed = sessions.page(session, row.id, now=NOW)

    assert ids(resumed)[:7] == ids(first)[3:]


def test_seen_events_never_move_the_position_back(session: Session, book: Document):
    shelf(session, book)
    row, first = sessions.create(session, EXPLORE, seed=3, now=NOW)
    see(session, row, first.pills[5])
    see(session, row, first.pills[1])
    assert stored(session, row).position == 6


def test_a_scope_that_runs_dry_ends_the_session(session: Session, book: Document):
    shelf(session, book, n=4)
    _, first = sessions.create(session, EXPLORE, seed=1, now=NOW)
    assert (len(first.pills), first.next_cursor, first.done) == (4, None, True)


def test_an_endless_session_goes_on_while_pills_last(session: Session, book: Document):
    shelf(session, book, n=30)
    endless = EXPLORE.model_copy(update={"length": None})
    row, page = sessions.create(session, endless, seed=1, now=NOW)
    served = ids(page)
    while page.next_cursor is not None:
        page = sessions.page(session, row.id, cursor=page.next_cursor, now=NOW)
        served += ids(page)
    assert len(served) == len(set(served)) == 30


def test_due_reviews_in_scope_become_review_pills(session: Session, book: Document):
    shelf(session, book, n=12)
    read(session, book, "ch06", 1.0)
    item = make_review_item(session, book, "ch02/p001")
    make_review_item(session, book, due=NOW.replace(year=2027))  # not due

    _, page = sessions.create(session, FeedConfig(), seed=1, now=NOW)

    reviews = [p for p in page.pills if p.kind is PillKind.REVIEW]
    assert [p.review_item_id for p in reviews] == [item.id]
    pill = reviews[0]
    assert (pill.id, pill.anchor, pill.origin) == (item.id, "ch02", "review:flashcard")
    assert pill.body["prompt"] == item.prompt
    assert pill.sources["ch02/p001"].document.id == book.id


def test_review_mode_serves_due_reviews_only(session: Session, book: Document):
    shelf(session, book, n=6)
    items = [make_review_item(session, book) for _ in range(3)]
    review = FeedConfig.model_validate({"mode": "review"})

    _, page = sessions.create(session, review, seed=1, now=NOW)

    assert {p.id for p in page.pills} == {i.id for i in items}
    assert page.done


def test_consolidate_falls_back_with_a_notice(session: Session, book: Document):
    shelf(session, book, n=3)
    _, page = sessions.create(session, FeedConfig(), seed=1, now=NOW)
    assert page.notice == "nothing read yet"
    assert len(page.pills) == 3


def test_threads_are_served_together(session: Session, book: Document):
    shelf(session, book, n=10)
    thread = [
        make_pill(session, book, "ch03", thread_key="arc", thread_index=i, thread_title="Arc")
        for i in range(3)
    ]
    row, first = sessions.create(
        session, EXPLORE.model_copy(update={"length": 13}), seed=2, now=NOW
    )
    rest = sessions.page(session, row.id, cursor=first.next_cursor, now=NOW)
    served = first.pills + rest.pills

    at = [p.id for p in served].index(thread[0].id)
    assert [p.id for p in served[at : at + 3]] == [p.id for p in thread]
    assert served[at].thread is not None
    assert (served[at].thread.size, served[at].thread.title) == (3, "Arc")


def test_a_bad_cursor_is_invalid(session: Session, book: Document):
    shelf(session, book, n=2)
    row, _ = sessions.create(session, EXPLORE, seed=1, now=NOW)
    with pytest.raises(InvalidInputError):
        sessions.page(session, row.id, cursor="ten")

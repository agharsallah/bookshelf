"""What past events say (`app.pills.feed.history`): the inputs ranking works from."""

from datetime import timedelta

from sqlmodel import Session

from app.models import Document
from app.models.enums import PillEventKind, PillKind
from app.pills.feed import history
from app.pills.feed.rank import KindSignals
from tests.pills.feed_factories import NOW, make_event, make_pill, make_review_item


def test_per_pill_counts_views_and_confusion(session: Session, book: Document):
    pill = make_pill(session, book)
    item = make_review_item(session, book)
    make_event(session, PillEventKind.SEEN, pill=pill)
    make_event(session, PillEventKind.SEEN, pill=pill)
    make_event(session, PillEventKind.CONFUSING, pill=pill)
    make_event(session, PillEventKind.SEEN, review_item_id=item.id)

    seen, confusing = history.per_pill(session, [pill.id, item.id])

    assert (seen[pill.id], confusing[pill.id], seen[item.id]) == (2, 1, 1)


def test_unit_recent_counts_the_last_day_only(session: Session, book: Document):
    pill = make_pill(session, book, "ch02")
    make_event(session, PillEventKind.SEEN, pill=pill, at=NOW - timedelta(hours=2))
    make_event(session, PillEventKind.SEEN, pill=pill, at=NOW - timedelta(days=3))

    assert history.unit_recent(session, [book.id], now=NOW) == {(book.id, "ch02"): 1}


def test_kind_signals_cover_thirty_days_and_long_dwells(session: Session, book: Document):
    quote = make_pill(session, book, kind=PillKind.QUOTE)
    item = make_review_item(session, book)
    make_event(session, PillEventKind.SEEN, pill=quote)
    make_event(session, PillEventKind.SAVE, pill=quote)
    make_event(session, PillEventKind.DWELL, pill=quote, value={"ms": 20_000})
    make_event(session, PillEventKind.DWELL, pill=quote, value={"ms": 2_000})
    make_event(session, PillEventKind.SKIP, pill=quote, at=NOW - timedelta(days=40))
    make_event(session, PillEventKind.TOO_EASY, review_item_id=item.id)

    signals = history.kind_signals(session, now=NOW)

    assert signals[PillKind.QUOTE] == KindSignals(seen=1, saves=1, long_dwells=1)
    assert signals[PillKind.REVIEW] == KindSignals(too_easy=1)

"""Feed scope (`app.pills.feed.scope`): sources, archived books, reading and modes."""

from datetime import UTC, datetime

import pytest
from sqlmodel import Session

from app.core.errors import NotFoundError
from app.models import Collection, CollectionMember, Concept, Document, PaperSet
from app.models.enums import ConceptKind, Genre, PillKind
from app.pills.feed import candidates
from app.pills.feed.config import FeedConfig, FeedMode
from app.pills.feed.scope import NOTHING_READ, ReadState, allowed_units, read_units, resolve
from tests.pills.conftest import make_shelf_book
from tests.pills.feed_factories import NOW, make_pill, read

ORDER = ["ch01", "ch02", "ch03", "ch04", "ch05"]


def config(**fields: object) -> FeedConfig:
    return FeedConfig.model_validate(fields)


# --- Pure: units by mode ------------------------------------------------------------------


def test_read_units_are_those_before_the_latest_and_the_finished_ones():
    state = ReadState(progress={"ch03": 0.4, "ch05": 1.0}, current="ch03")
    assert read_units(ORDER, state) == {"ch01", "ch02", "ch05"}
    assert read_units(ORDER, ReadState(finished=True)) == set(ORDER)
    assert read_units(ORDER, ReadState()) == set()


@pytest.mark.parametrize(
    ("mode", "spoilers", "expected"),
    [
        (FeedMode.CONSOLIDATE, False, {"ch01", "ch02"}),
        (FeedMode.PREVIEW, False, {"ch03", "ch04"}),
        (FeedMode.EXPLORE, False, {"ch01", "ch02", "ch03"}),
        (FeedMode.EXPLORE, True, set(ORDER)),
        (FeedMode.REVIEW, False, set()),
    ],
)
def test_each_mode_allows_its_units(mode: FeedMode, spoilers: bool, expected: set[str]):
    state = ReadState(progress={"ch03": 0.4}, current="ch03")
    assert allowed_units(mode, ORDER, state, spoilers=spoilers) == expected


def test_an_unstarted_book_is_explored_whole_and_previewed_from_the_start():
    assert allowed_units(FeedMode.EXPLORE, ORDER, ReadState(), spoilers=False) == set(ORDER)
    assert allowed_units(FeedMode.PREVIEW, ORDER, ReadState(), spoilers=False) == {"ch01", "ch02"}


# --- Sources ------------------------------------------------------------------------------


def test_documents_are_named_by_slug_or_id_and_archived_ones_never_count(
    session: Session, book: Document
):
    other = make_shelf_book(session)
    gone = make_shelf_book(session, archived_at=datetime.now(UTC))
    refs = [book.slug, str(other.id), gone.slug]
    assert set(resolve(session, config(sources={"documents": refs})).documents) == {
        book.id,
        other.id,
    }
    assert set(resolve(session, FeedConfig()).documents) == {book.id, other.id}


def test_collections_paper_sets_and_genre(session: Session, book: Document):
    paper = make_shelf_book(session, genre=Genre.PAPER)
    shelf = Collection(name="Ops", slug="ops")
    papers = PaperSet(name="Queues", document_ids=[paper.id])
    session.add_all([shelf, papers])
    session.commit()
    session.add(CollectionMember(collection_id=shelf.id, document_id=book.id, position=0))
    session.commit()

    by_slug = resolve(session, config(sources={"collections": ["ops"]}))
    by_set = resolve(session, config(sources={"paper_sets": [str(papers.id)]}))
    by_name = resolve(session, config(sources={"paper_sets": ["Queues"]}))
    papers_only = resolve(session, config(sources={"genre": "paper"}))

    assert set(by_slug.documents) == {book.id}
    assert set(by_set.documents) == set(by_name.documents) == {paper.id}
    assert set(papers_only.documents) == {paper.id}


def test_unknown_sources_are_not_found(session: Session):
    with pytest.raises(NotFoundError):
        resolve(session, config(sources={"documents": ["nope"]}))
    with pytest.raises(NotFoundError):
        resolve(session, config(sources={"concepts": ["00000000-0000-0000-0000-000000000009"]}))


def test_concepts_by_name_or_id_scope_the_pills(session: Session, book: Document):
    other = make_shelf_book(session)
    concept = Concept(canonical="Little's Law", aliases=["L = λW"], kind=ConceptKind.TERM)
    session.add(concept)
    session.commit()
    on = make_pill(session, book, "ch01", concepts=["little's law"])
    make_pill(session, book, "ch02", concepts=["slack"])
    elsewhere = make_pill(session, other, "ch01", concepts=["L = λW"])

    for ref in (str(concept.id), "LITTLE'S LAW"):
        scope = resolve(session, config(mode="explore", sources={"concepts": [ref]}))
        assert set(scope.documents) == {book.id, other.id}
        assert {p.id for p in candidates.scope_pills(session, scope)} == {on.id, elsewhere.id}


# --- Modes over the database --------------------------------------------------------------


def test_consolidate_falls_back_to_explore_when_nothing_is_read(session: Session, book: Document):
    make_pill(session, book, "ch04")
    scope = resolve(session, FeedConfig())
    assert (scope.mode, scope.notice) == (FeedMode.EXPLORE, NOTHING_READ)


def test_consolidate_serves_the_units_read(session: Session, book: Document):
    done = make_pill(session, book, "ch01")
    make_pill(session, book, "ch02")
    make_pill(session, book, "ch05")
    read(session, book, "ch01", 1.0, at=NOW)
    read(session, book, "ch02", 0.3, at=NOW.replace(hour=13))

    scope = resolve(session, FeedConfig())

    assert (scope.mode, scope.notice) == (FeedMode.CONSOLIDATE, None)
    assert [p.id for p in candidates.scope_pills(session, scope)] == [done.id]


def test_preview_serves_active_pills_of_the_next_units(session: Session, book: Document):
    read(session, book, "ch01", 1.0)
    make_pill(session, book, "ch02", PillKind.INSIGHT)
    quiz = make_pill(session, book, "ch02", PillKind.QUIZ)
    make_pill(session, book, "ch05", PillKind.QUIZ)

    scope = resolve(session, config(mode="preview"))

    assert [p.id for p in candidates.scope_pills(session, scope)] == [quiz.id]


def test_kinds_and_retired_pills(session: Session, book: Document):
    quote = make_pill(session, book, "ch01", PillKind.QUOTE)
    make_pill(session, book, "ch01", PillKind.INSIGHT)
    make_pill(session, book, "ch01", PillKind.QUOTE, retired_at=NOW)

    scope = resolve(session, config(mode="explore", kinds=["quote"]))

    assert [p.id for p in candidates.scope_pills(session, scope)] == [quote.id]


def test_a_connection_told_from_both_documents_is_served_once(session: Session, book: Document):
    other = make_shelf_book(session, title="Other", slug="other")

    def side(doc: Document, anchor: str) -> dict[str, object]:
        return {
            "document": {"id": str(doc.id), "slug": doc.slug, "title": doc.title},
            "anchor": anchor,
            "spans": [{"text": "Feedback steers a system toward its goal.", "cites": [anchor]}],
        }

    def connection(doc: Document, mine: str, theirs: Document, there: str):
        body = {"relation": "echoes", "sides": [side(doc, mine), side(theirs, there)]}
        return make_pill(session, doc, mine.split("/")[0], PillKind.CONNECTION, body=body)

    connection(book, "ch01/p001", other, "ch02/p004")
    connection(other, "ch02/p004", book, "ch01/p001")  # the same edge, told from `other`
    connection(book, "ch01/p001", other, "ch03/p001")  # another edge

    rows = candidates.scope_pills(session, resolve(session, config(mode="explore")))

    assert len([r for r in rows if r.kind is PillKind.CONNECTION]) == 2
    only_book = resolve(session, config(mode="explore", sources={"documents": [book.slug]}))
    assert len(candidates.scope_pills(session, only_book)) == 2

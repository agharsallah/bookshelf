"""Library cards: the catalogue-document input, and the shelf's themes read back from cards."""

from pathlib import Path
from typing import Any

from sqlmodel import Session

from app.models import Artifact, Document
from app.models.enums import ArtifactType, NodeKind, Origin, Review
from app.pipeline import catalogue
from app.pipeline.selectors import select_inputs
from tests.pipeline.runtime.conftest import add_document, add_nodes

FACTS = {"publisher": None, "published": None, "edition": None, "isbn": None, "language": "en",
         "series": None}  # fmt: skip


def card(session: Session, doc: Document, theme: str, *, version: int = 1,
         review: Review = Review.APPROVED, **body: Any) -> Artifact:  # fmt: skip
    artifact = Artifact(
        document_id=doc.id, type=ArtifactType.CATALOGUE_ENTRY, version=version,
        origin=Origin.SKILL, skill="catalogue-document", skill_version="1",
        input_hash=f"{doc.slug}-{version}", review=review,
        body={"theme": {"name": theme, "new": False}, "subjects": ["Stocks"], "form": "textbook",
              "audience": "Anyone", "level": "introductory", "description": "Systems, simply.",
              "facts": FACTS, "cites": ["ch01/s01/p001"], **body},
    )  # fmt: skip
    session.add(artifact)
    session.commit()
    return artifact


def select(session: Session, doc: Document) -> dict[str, Any]:
    selection = select_inputs(session, "document_catalogue", doc, None, media_dir=Path("/media"))
    return selection.inputs


def test_the_card_reads_front_matter_contents_and_the_other_books_themes(
    session: Session, book: Document, other_book: Document
):
    card(session, other_book, "Systems thinking")
    card(session, book, "Its own draft theme", review=Review.DRAFT)  # never offered to itself

    inputs = select(session, book)

    assert inputs["known"] == {"genre": "book", "format": "pdf", "language": "en", "pages": 10,
                               "tags": []}  # fmt: skip
    assert inputs["front_matter"][0] == {
        "anchor": "ch01/s01/p001", "page": 1,
        "text": "A stock is the memory of the history of flows.",
    }  # fmt: skip
    # Skipped containers (the bibliography) are not the book's front matter.
    assert "bm01/p001" not in [b["anchor"] for b in inputs["front_matter"]]
    assert inputs["contents"] == [
        {"anchor": "ch01", "heading": "Stocks and flows"},
        {"anchor": "ch02", "heading": "Feedback"},
    ]
    assert inputs["existing_themes"] == [{"name": "Systems thinking", "documents": 1}]
    assert inputs["chapter_takeaways"] == []
    assert "abstract" not in inputs


def test_front_matter_is_the_first_pages_only_and_capped(session: Session):
    doc = add_document(session, slug="long-book")
    spec = [("ch01", NodeKind.CHAPTER, "One", {})]
    spec += [(f"ch01/p{n:03}", NodeKind.PARAGRAPH, f"Line {n} " + "word " * 200, {})
             for n in range(1, 80)]  # fmt: skip
    add_nodes(session, doc, spec)

    front = select(session, doc)["front_matter"]

    assert len(front) == 40
    assert all(block["page"] <= 12 for block in front)
    assert all(len(block["text"]) <= 600 for block in front)


def test_shelf_themes_prefer_approved_cards_and_merge_spellings(session: Session):
    docs = [add_document(session, slug=f"book-{n}") for n in range(4)]
    card(session, docs[0], "Machine learning")
    card(session, docs[1], "machine  Learning", review=Review.DRAFT)
    card(session, docs[2], "Career", version=1)
    card(session, docs[2], "Careers", version=2, review=Review.DRAFT)  # the approved v1 wins
    card(session, docs[3], "Poetry", review=Review.REJECTED)

    assert catalogue.shelf_themes(session) == [
        {"name": "Machine learning", "documents": 2},
        {"name": "Career", "documents": 1},
    ]
    # Without the first book, the tie goes alphabetical; spacing is always collapsed.
    assert catalogue.shelf_themes(session, exclude=docs[0].id) == [
        {"name": "Career", "documents": 1},
        {"name": "machine Learning", "documents": 1},
    ]


def test_a_card_shows_in_the_shelfs_spelling_and_says_when_it_is_a_draft(session: Session):
    one, two, three = (add_document(session, slug=f"doc-{n}") for n in range(3))
    card(session, one, "Machine learning")
    card(session, two, "Machine learning")
    card(session, three, "machine learning", review=Review.NEEDS_REVIEW,
         facts={**FACTS, "isbn": "9780262035613"}, extra_key="ignored")  # fmt: skip

    cards = catalogue.cards(session, [three.id, one.id])

    assert cards[three.id] == {
        "theme": "Machine learning", "subjects": ["Stocks"], "form": "textbook",
        "audience": "Anyone", "level": "introductory", "description": "Systems, simply.",
        **FACTS, "isbn": "9780262035613", "draft": True,
    }  # fmt: skip
    assert cards[one.id]["draft"] is False
    assert catalogue.cards(session, []) == {}

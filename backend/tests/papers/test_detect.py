"""papers.detect: is it a paper, and when may detection change the genre."""

from app.models import Document
from app.models.enums import DocumentKind, Genre, NodeKind
from app.papers.detect import (
    GENRE_DETECTED,
    PaperMode,
    Signals,
    apply_guess,
    guess_genre,
    paper_mode,
    tree_signals,
)
from app.pipeline.parse import ParsedDocument, ParsedNode

PAPER_HEADINGS = ("Abstract", "1 Introduction", "2 Method", "3 Results", "References")


def _document(**fields: object) -> Document:
    base: dict[str, object] = {
        "kind": DocumentKind.PDF,
        "slug": "x",
        "title": "x",
        "sha256": "a" * 64,
    }
    return Document(**(base | fields))


def test_abstract_and_references_in_a_short_document_make_a_paper():
    guess = guess_genre(Signals(12, PAPER_HEADINGS, "Ada Lovelace ada@example.org"))

    assert guess.genre is Genre.PAPER
    assert {"abstract", "references", "numbered sections"} <= set(guess.reasons)


def test_a_long_book_with_references_is_not_a_paper():
    assert guess_genre(Signals(320, PAPER_HEADINGS, "")).genre is None


def test_without_a_references_heading_there_is_no_opinion():
    assert (
        guess_genre(Signals(10, ("Abstract", "1 Introduction"), "arXiv:2101.00001")).genre is None
    )


def test_an_arxiv_id_and_an_introduction_stand_in_for_a_missing_abstract():
    signals = Signals(9, ("INTRODUCTION", "REFERENCES"), "arXiv:2101.00001v2 [cs.CL]")

    assert guess_genre(signals).is_paper


def test_numbered_back_matter_headings_still_count():
    assert guess_genre(Signals(9, ("Abstract", "7 References"), "")).is_paper


def test_a_person_choosing_the_genre_turns_detection_off():
    assert (
        paper_mode(_document(genre=Genre.PAPER, meta={"genre_source": "human"})) is PaperMode.FORCE
    )
    assert (
        paper_mode(_document(genre=Genre.BOOK, meta={"genre_source": "human"})) is PaperMode.NEVER
    )
    assert paper_mode(_document(genre=Genre.BOOK)) is PaperMode.AUTO


def _tree(*headings: str) -> ParsedDocument:
    children = [
        ParsedNode(NodeKind.CHAPTER, heading=h, children=[ParsedNode(NodeKind.PARAGRAPH, text="x")])
        for h in headings
    ]
    return ParsedDocument(page_count=8, children=children)


def test_tree_signals_read_container_headings_and_short_lines():
    parsed = _tree("Abstract", "References")
    parsed.children[0].children.append(ParsedNode(NodeKind.PARAGRAPH, text="arXiv:1", page_from=1))

    signals = tree_signals(parsed)

    assert "Abstract" in signals.headings and "arXiv:1" in signals.first_page


def test_a_detected_paper_is_marked_so_a_later_parse_may_undo_it():
    document = _document()

    apply_guess(document, _tree(*PAPER_HEADINGS), from_tree=True)
    assert (document.genre, document.meta) == (Genre.PAPER, {"genre_source": GENRE_DETECTED})

    apply_guess(document, _tree("Chapter 1", "Chapter 2"), from_tree=True)
    assert (document.genre, document.meta) == (Genre.BOOK, {})


def test_the_strategy_verdict_wins_over_tree_signals_for_pdfs():
    document = _document()

    apply_guess(document, _tree(*PAPER_HEADINGS), from_tree=False)  # no strategy verdict

    assert document.genre is Genre.BOOK


def test_a_human_genre_is_never_overridden():
    document = _document(genre=Genre.BOOK, meta={"genre_source": "human"})

    apply_guess(document, _tree(*PAPER_HEADINGS), from_tree=True)

    assert document.genre is Genre.BOOK

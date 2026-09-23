"""PDF tier ladder, outline placement, manual outline override and document metadata."""

from pathlib import Path

import pytest

from app.models.enums import NodeKind
from app.pipeline.parse import ParsedDocument, load_override
from app.pipeline.parse.anchors import ANCHOR_RE, node_hash
from app.pipeline.parse.pdf import parse_pdf
from tests.pipeline.parse.builders import book_pdf, scanned_pdf
from tests.pipeline.parse.conftest import of_kind, outline

BOOK_OUTLINE = [
    ("ch01", "Chapter 1 Stocks"),
    ("ch01/s01", "1.1 Flows"),
    ("ch02", "Chapter 2 Loops"),
]


@pytest.fixture(scope="module")
def untitled_book(tmp_path_factory: pytest.TempPathFactory) -> Path:
    return book_pdf(tmp_path_factory.mktemp("pdf") / "no-toc.pdf", toc=False)


def test_embedded_outline_is_tier_1_and_needs_no_review(book: ParsedDocument):
    assert (book.tier, book.needs_review) == (1, False)
    assert outline(book) == BOOK_OUTLINE


def test_outline_title_lines_are_consumed_not_repeated_as_paragraphs(book: ParsedDocument):
    texts = [n.text for n in book.walk() if n.text]

    assert "Chapter 1 Stocks" not in texts
    assert "1.1 Flows" not in texts


def test_containers_span_the_pages_of_their_content(book: ParsedDocument):
    spans = [(n.anchor, n.page_from, n.page_to) for n in book.walk() if n.kind.is_container]

    assert spans == [("ch01", 1, 2), ("ch01/s01", 1, 2), ("ch02", 2, 3)]


def test_without_outline_headings_come_from_font_sizes_and_need_review(
    untitled_book: Path, tmp_path: Path
):
    parsed = parse_pdf(untitled_book, slug="b", media_dir=tmp_path)

    assert (parsed.tier, parsed.needs_review) == (2, True)
    assert outline(parsed) == BOOK_OUTLINE


def test_scanned_pages_are_ocred_as_tier_3_and_need_review(tmp_path: Path):
    parsed = parse_pdf(scanned_pdf(tmp_path / "scan.pdf"), slug="s", media_dir=tmp_path)

    assert (parsed.tier, parsed.needs_review) == (3, True)
    text = " ".join(n.text or "" for n in parsed.walk())
    assert "quick brown fox" in text
    assert of_kind(parsed, NodeKind.FIGURE) == []  # the page image is the scan, not a figure


def test_anchors_are_valid_unique_and_identical_across_runs(book_path: Path, tmp_path: Path):
    first = parse_pdf(book_path, slug="meadows", media_dir=tmp_path)
    second = parse_pdf(book_path, slug="meadows", media_dir=tmp_path)

    anchors = [n.anchor for n in first.walk()]
    assert all(ANCHOR_RE.match(a) for a in anchors)
    assert len(set(anchors)) == len(anchors)
    assert [(n.anchor, node_hash(n)) for n in first.walk()] == [
        (n.anchor, node_hash(n)) for n in second.walk()
    ]


def test_metadata_supplies_title_authors_and_year(book: ParsedDocument):
    assert (book.title, book.authors, book.year, book.page_count) == (
        "Thinking in Systems",
        ["Donella Meadows"],
        2008,
        3,
    )


def test_outline_override_replaces_detected_boundaries_and_clears_review(
    untitled_book: Path, tmp_path: Path
):
    override = load_override(
        [
            {"title": "Stocks and flows", "page_from": 1, "sections": [
                {"title": "Flows", "page_from": 1}]},
            {"title": "Loops", "page_from": 2, "page_to": 2},
        ]
    )  # fmt: skip

    parsed = parse_pdf(untitled_book, slug="b", media_dir=tmp_path, outline_override=override)

    assert outline(parsed) == [
        ("ch01", "Stocks and flows"),
        ("ch01/s01", "Flows"),  # placed on the `1.1 Flows` line, which is consumed
        ("ch02", "Loops"),
        ("ch03", "Back matter"),  # pages after the last chapter's page_to
    ]
    back = parsed.children[-1]
    assert back.meta["skip"] is True
    assert {n.page_from for n in back.children} == {3}
    assert "Chapter 1 Stocks" in [n.text for n in parsed.walk()]  # detected heading demoted
    assert (parsed.tier, parsed.needs_review) == (2, False)


def test_override_title_missing_from_its_page_starts_the_chapter_at_the_page_top(
    untitled_book: Path, tmp_path: Path
):
    override = load_override(
        [{"title": "Opening", "page_from": 1}, {"title": "Unseen title", "page_from": 3}]
    )

    parsed = parse_pdf(untitled_book, slug="b", media_dir=tmp_path, outline_override=override)

    [opening, unseen] = parsed.children
    assert (opening.heading, opening.page_to) == ("Opening", 2)
    assert (unseen.heading, unseen.page_from) == ("Unseen title", 3)


@pytest.mark.parametrize(
    "raw",
    [
        [],
        [{"title": "A", "page_from": 5}, {"title": "B", "page_from": 2}],
        [
            {
                "title": "A",
                "page_from": 5,
                "page_to": 9,
                "sections": [{"title": "s", "page_from": 11}],
            }
        ],
        [{"title": "A", "page_from": 0}],
        [{"title": "A", "page_from": 1, "chapters": []}],
    ],
    ids=["empty", "chapters-out-of-order", "section-outside-chapter", "page-zero", "unknown-key"],
)
def test_invalid_outline_override_is_rejected(raw: object):
    with pytest.raises(ValueError):
        load_override(raw)

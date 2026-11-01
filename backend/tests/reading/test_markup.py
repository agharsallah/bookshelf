"""The reading's HTML and PDF: links between parts, citations to chapters, a paged contents."""

import pymupdf

from app.reading.markup import reading_html
from app.reading.model import Piece, Reading, knowledge_blocks
from app.reading.pdf import render_pdf


def paragraph(text: str, *cites: str) -> dict:
    return {"type": "paragraph", "spans": [{"text": text, "cites": list(cites)}]}


def reading(*pieces: Piece) -> Reading:
    return Reading(
        title="Thinking <in> Systems",
        byline="Donella Meadows · 2008",
        edition="Composed edition",
        deck="One argument.",
        pieces=list(pieces),
        chapters={"ch01": "ch01"},
    )


CHAPTER = Piece(
    "ch01",
    "Chapters",
    "Chapter 1",
    "The bathtub",
    [paragraph("Inflow and outflow.", "ch01/s02/p004", "ch09/p001")],
    lead=[paragraph("Where the stock first appears.", "ch01/p001")],
    see=(("through-line", "Stocks remember"),),
)


def test_a_citation_links_to_the_chapter_it_sits_in_when_that_chapter_is_printed():
    book = reading(CHAPTER)

    assert book.cite_target("ch01/s02/p004") == "ch01"
    assert book.cite_target("ch09/p001") is None
    page = reading_html(book)
    assert '<a href="#ch01">ch01/s02/p004</a>' in page
    assert ", ch09/p001</sup>" in page  # printed, but nowhere to go


def test_the_contents_groups_pieces_and_prints_measured_pages():
    intro = Piece("through-line", "Introduction", "The through-line", "Stocks", [paragraph("x")])

    unmeasured = reading_html(reading(intro, CHAPTER))
    measured = reading_html(reading(intro, CHAPTER), {"through-line": 3, "ch01": 4})

    assert unmeasured.index("INTRODUCTION") < unmeasured.index("CHAPTERS")
    assert '<a href="#ch01">\u2013</a>' in unmeasured
    assert '<a href="#ch01">4</a>' in measured


def test_the_bridge_and_see_also_print_only_when_the_edition_gives_them():
    plain = Piece("ch02", "Chapters", "Chapter 2", "Zoo", [paragraph("Notes.")])

    page = reading_html(reading(CHAPTER, plain))
    second = page[page.index('id="ch02"') :]

    assert page.index("WHERE THIS SITS") < page.index("THE APPROVED NOTES")
    assert '<a href="#through-line">Stocks remember</a>' in page
    assert "WHERE THIS SITS" not in second and "SEE ALSO" not in second


def test_text_from_the_notes_is_escaped():
    page = reading_html(reading(CHAPTER))

    assert "Thinking &lt;in&gt; Systems" in page
    assert "<in>" not in page


def test_result_rows_drop_the_parts_they_lack():
    blocks = knowledge_blocks(
        {"rows": [{"method": "Ours", "dataset": "ImageNet", "value": 81.2, "metric": "top-1"}]}
        | {"claims": []}
    )
    lacking = knowledge_blocks({"rows": [{"method": "Ours", "value": None}]})

    assert blocks[0]["items"][0][0]["text"] == "Ours on ImageNet: 81.2 top-1"
    assert lacking[0]["items"][0][0]["text"] == "Ours"


def test_an_empty_reading_is_a_cover_and_a_contents_page():
    document = pymupdf.open(stream=render_pdf(reading()), filetype="pdf")

    assert document.page_count == 2
    assert "Nothing approved to read yet" in document[1].get_text()
    assert [entry[1] for entry in document.get_toc()] == ["Thinking <in> Systems", "Contents"]

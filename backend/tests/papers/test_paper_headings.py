"""papers.headings, refblocks and outline on synthetic PDF blocks, plus one generated PDF."""

from pathlib import Path

import pytest

from app.models.enums import Genre
from app.papers.detect import PaperMode
from app.papers.headings import detect_paper_headings
from app.papers.outline import confidence, paper_strategy
from app.papers.refblocks import merge_entries, regroup_references
from app.pipeline.parse.model import Heading, ParsedNode
from app.pipeline.parse.pdf import parse_pdf
from app.pipeline.parse.pdf.layout import Block, Line
from tests.papers.paper_pdf import TITLE, paper_pdf

BODY = 10.0


class Page:
    """Blocks stacked down a page, one line each unless given several."""

    def __init__(self, page: int = 1) -> None:
        self.page, self.y = page, 60.0

    def block(
        self, *texts: str, size: float = BODY, bold: bool = False, x: float = 72, gap: float = 1.0
    ) -> Block:
        lines = []
        for i, text in enumerate(texts):
            indent = x if i == 0 else x + 14
            lines.append(Line(self.page, (indent, self.y, 500, self.y + size), text, size, bold))
            self.y += size + 2
        self.y += size * gap
        return Block(page=self.page, lines=lines, column=(72, 500))


def _heading(page: Page, text: str, size: float = 12) -> Block:
    return page.block(text, size=size, bold=True)


def _prose(page: Page) -> Block:
    return page.block("A long paragraph of body text that is clearly prose, not a heading.")


def _outline(items) -> list[tuple[int, str]]:
    return [
        (h.level, h.title)
        for h in detect_paper_headings(items, BODY).placed
        if isinstance(h, Heading)
    ]


def test_numbered_sections_nest_by_their_numbers_and_named_ones_are_units():
    p = Page()
    items = [
        _heading(p, "Abstract"),
        _prose(p),
        _heading(p, "1 Introduction"),
        _prose(p),
        _heading(p, "1.1 Scope", 10.5),
        _prose(p),
        _heading(p, "1.1.1 Detail", 10),
        _prose(p),
        _heading(p, "2 Method"),
        _prose(p),
        _heading(p, "References"),
        _prose(p),
    ]

    assert _outline(items) == [
        (1, "Abstract"),
        (1, "1 Introduction"),
        (2, "1.1 Scope"),
        (3, "1.1.1 Detail"),
        (1, "2 Method"),
        (1, "References"),
    ]


def test_numbers_out_of_sequence_or_before_the_abstract_are_not_headings():
    p = Page()
    items = [
        _heading(p, "1 Google Research"),
        _heading(p, "Abstract"),
        _prose(p),
        _heading(p, "1 Introduction"),
        _heading(p, "7 Tables"),
        _heading(p, "3.1 Orphan"),
        _heading(p, "2 Method"),
    ]

    found = detect_paper_headings(items, BODY)

    assert _outline(items) == [(1, "Abstract"), (1, "1 Introduction"), (1, "2 Method")]
    assert found.top_numbers == [1, 2]


def test_a_skipped_number_is_accepted_but_counted_as_a_gap():
    p = Page()
    items = [_heading(p, "1 Introduction"), _heading(p, "3 Results"), _heading(p, "4 Conclusion")]

    found = detect_paper_headings(items, BODY)

    assert (found.top_numbers, found.gaps) == ([1, 3, 4], 1)


def test_the_title_is_the_largest_type_on_page_one_and_not_a_heading():
    p = Page()
    items = [
        p.block("Tiny Transformers", size=18, bold=True),
        p.block("Work Well", size=18, bold=True),
        p.block("Ada Lovelace", size=11, bold=True),
        _heading(p, "Abstract"),
        _prose(p),
    ]

    found = detect_paper_headings(items, BODY)

    assert found.title == "Tiny Transformers Work Well"
    assert _outline(items) == [(1, "Abstract")]


def test_run_in_acknowledgements_become_a_unit_with_their_paragraph():
    p = Page()
    run_in = p.block("Acknowledgements We thank the engine room for all their patience.")
    items = [_heading(p, "1 Introduction"), _prose(p), run_in]

    placed = detect_paper_headings(items, BODY).placed

    assert isinstance(placed[-2], Heading) and placed[-2].title == "Acknowledgements"
    assert isinstance(placed[-1], Block) and placed[-1].text.startswith("We thank")


def test_appendix_letters_count_only_after_the_references_with_wrapped_titles_joined():
    p = Page()
    items = [
        _heading(p, "A Tale"),
        _heading(p, "1 Introduction"),
        _prose(p),
        _heading(p, "References"),
        p.block("[1] Someone. Something. 2017."),
        p.block('Appendix for "Tiny', size=12, bold=True, gap=0.2),
        _heading(p, 'Transformers"'),
        _heading(p, "A Proofs"),
        _heading(p, "A.1 Lemma", 10.5),
        _heading(p, "Attention Visualizations"),
    ]

    assert _outline(items) == [
        (1, "1 Introduction"),
        (1, "References"),
        (1, 'Appendix for "Tiny Transformers"'),
        (1, "A Proofs"),
        (2, "A.1 Lemma"),
        (1, "Attention Visualizations"),
    ]


def test_confidence_needs_numbering_in_sequence_and_both_named_headings():
    p = Page()
    good = [
        _heading(p, "Abstract"),
        _heading(p, "1 Introduction"),
        _heading(p, "2 Method"),
        _heading(p, "3 Results"),
        _heading(p, "References"),
    ]

    assert confidence(detect_paper_headings(good, BODY))[0]
    confident, note = confidence(detect_paper_headings(good[1:], BODY))
    assert not confident and "no Abstract heading" in note


def test_hanging_indent_lines_regroup_into_one_entry_each():
    p = Page(10)
    blocks = [
        p.block("Alan Akbik, Duncan Blythe, and Roland"),
        p.block("Vollgraf. 2018. Contextual.", x=86),
        p.block("Rie Ando and Tong Zhang. 2005. A framework", "for learning structures."),
    ]

    entries = merge_entries(blocks)

    assert [e.text for e in entries] == [
        "Alan Akbik, Duncan Blythe, and Roland Vollgraf. 2018. Contextual.",
        "Rie Ando and Tong Zhang. 2005. A framework for learning structures.",
    ]
    assert all(e.meta == {"reference": True} for e in entries)


def test_numbered_entries_start_at_each_marker_even_without_an_indent():
    p = Page(10)
    blocks = [
        p.block("[1] Jimmy Ba. Layer normalization.", "arXiv preprint, 2016."),
        p.block("[2] Alex Graves. Generating sequences, 2013."),
    ]
    blocks[0].lines[1].bbox = (72, *blocks[0].lines[1].bbox[1:])

    assert len(merge_entries(blocks)) == 2


def test_only_the_references_section_is_regrouped():
    p = Page(3)
    stream = [
        Heading(1, "Results"),
        p.block("Plain prose."),
        Heading(1, "References"),
        p.block("[1] A. One."),
        Heading(1, "A Appendix"),
        p.block("More prose."),
    ]

    out = regroup_references(stream)

    assert [type(x).__name__ for x in out] == [
        "Heading",
        "Block",
        "Heading",
        "ParsedNode",
        "Heading",
        "Block",
    ]
    assert isinstance(out[3], ParsedNode) and out[3].text == "[1] A. One."


@pytest.fixture(scope="module")
def tiny(tmp_path_factory: pytest.TempPathFactory) -> Path:
    return paper_pdf(tmp_path_factory.mktemp("paper") / "tiny.pdf")


def test_a_detected_paper_pdf_is_outlined_confirmed_and_marked(tiny: Path, tmp_path: Path):
    parsed = parse_pdf(
        tiny, slug="tiny", media_dir=tmp_path, strategy=paper_strategy(PaperMode.AUTO)
    )

    units = [(n.anchor, n.heading) for n in parsed.children]
    assert units == [
        ("fm01", "Front matter"),
        ("ch01", "Abstract"),
        ("ch02", "1 Introduction"),
        ("ch03", "2 Method"),
        ("ch04", "3 Results"),
        ("ch05", "4 Conclusion"),
        ("ch06", "Acknowledgements"),
        ("ch07", "References"),
    ]
    assert (parsed.genre, parsed.title, parsed.tier, parsed.needs_review) == (
        Genre.PAPER,
        TITLE,
        2,
        False,
    )
    assert parsed.children[3].children[1].heading == "2.1 Setup"
    assert len(parsed.children[7].children) == 3  # one paragraph per reference


def test_never_mode_keeps_the_book_heuristics(tiny: Path, tmp_path: Path):
    parsed = parse_pdf(
        tiny, slug="tiny", media_dir=tmp_path, strategy=paper_strategy(PaperMode.NEVER)
    )

    assert parsed.genre is None and parsed.needs_review

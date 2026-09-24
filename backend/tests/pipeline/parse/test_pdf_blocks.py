"""PDF region classifier and prose path: every block kind lands as its own anchored block."""

from pathlib import Path
from typing import Any

import pytest

from app.models.enums import NodeKind
from app.pipeline.parse import ParsedDocument
from app.pipeline.parse.pdf import parse_pdf
from tests.pipeline.parse.builders import (
    CAPTION,
    CODE,
    HEADER,
    LEFT,
    LONG_LABEL,
    RIGHT,
    TABLE_HEADER,
    TABLE_ROWS,
    boxed_diagram_pdf,
    decorated_text_pdf,
    diagram_pdf,
    list_pdf,
)
from tests.pipeline.parse.conftest import of_kind

ITEMS = ["inflows fill it", "outflows drain it", "delays smooth it"]


def test_running_headers_and_page_numbers_are_stripped(book: ParsedDocument):
    texts = [n.text for n in book.walk() if n.text]

    assert not [t for t in texts if HEADER in t]
    assert not [t for t in texts if t.strip() in {"1", "2", "3"}]


def test_hyphenated_line_breaks_are_joined(book: ParsedDocument):
    first = of_kind(book, NodeKind.PARAGRAPH)[0]

    assert first.anchor == "ch01/p001"
    assert first.text == (
        "A stock is the memory of a system and this opening paragraph wraps across two lines."
    )


def test_ruled_grid_becomes_one_table_block_with_header_rows_and_caption(book: ParsedDocument):
    [table] = of_kind(book, NodeKind.TABLE)

    assert table.meta["table"] == {"header": TABLE_HEADER, "rows": TABLE_ROWS}
    assert table.meta["caption"] == "Table 1.1 Stocks and their rates"
    assert table.meta["table_no"] == "1.1"
    assert not [p for p in of_kind(book, NodeKind.PARAGRAPH) if "Bathtub" in (p.text or "")]


def test_monospace_lines_become_code_with_indentation_language_and_listing(book: ParsedDocument):
    [code] = of_kind(book, NodeKind.CODE)

    assert code.anchor == "ch01/s01/c001"
    assert code.text == CODE
    assert code.meta == {
        "language": "python",
        "caption": "Listing 1.1 A flow function",
        "listing_no": "1.1",
    }


def test_bullets_become_one_list_block(book: ParsedDocument):
    [bullets] = of_kind(book, NodeKind.LIST)

    assert bullets.meta == {
        "items": ["inflows fill the stock", "outflows drain the stock"],
        "ordered": False,
    }


def test_centred_formula_becomes_display_math_with_latex_and_crop(
    book: ParsedDocument, media_dir: Path
):
    [math] = of_kind(book, NodeKind.MATH)

    assert math.meta["inline"] is False
    assert math.meta["latex"] == r"E = m \times c^2"
    assert math.meta["image_path"] == f"meadows/{math.anchor}.png"
    assert (media_dir / math.meta["image_path"]).read_bytes().startswith(b"\x89PNG")


def test_image_is_cropped_to_media_dir_and_paired_with_its_caption(
    book: ParsedDocument, media_dir: Path
):
    [figure] = of_kind(book, NodeKind.FIGURE)

    assert figure.anchor == "ch01/s01/f001"
    assert figure.meta["caption"] == "Figure 1.1 A stock drawn as a bathtub"
    assert figure.meta["figure_no"] == "1.1"
    assert figure.meta["page"] == 2
    assert figure.meta["bbox"] == [72.0, 80.0, 272.0, 200.0]
    assert figure.meta["image_path"] == "meadows/ch01/s01/f001.png"
    assert (media_dir / "meadows/ch01/s01/f001.png").read_bytes().startswith(b"\x89PNG")


def test_shaded_box_becomes_an_aside_with_its_label(book: ParsedDocument):
    [aside] = of_kind(book, NodeKind.ASIDE)

    assert aside.text == "Stocks change only through flows."
    assert aside.meta["label"] == "Key point"


def test_footnote_is_attached_to_the_page_block_not_inlined(book: ParsedDocument):
    owner = next(
        p for p in of_kind(book, NodeKind.PARAGRAPH) if p.text == "A loop feeds back on itself."
    )

    assert owner.meta["footnotes"] == [
        {"marker": "1", "text": "Meadows calls these feedback loops."}
    ]
    assert not [n for n in book.walk() if "calls these" in (n.text or "") and n is not owner]


def test_two_column_page_reads_left_column_before_right(book: ParsedDocument):
    page_three = [p.text for p in of_kind(book, NodeKind.PARAGRAPH) if p.page_from == 3]

    assert page_three == [f"{s} More words follow on." for s in [*LEFT, *RIGHT]]


def test_vector_drawing_cluster_becomes_a_figure_that_swallows_its_labels(tmp_path: Path):
    parsed = parse_pdf(diagram_pdf(tmp_path / "d.pdf"), slug="d", media_dir=tmp_path)

    [figure] = of_kind(parsed, NodeKind.FIGURE)
    assert figure.meta["caption"] == "Figure 2.1 A reinforcing loop"
    assert (tmp_path / figure.meta["image_path"]).is_file()
    assert [p.text for p in of_kind(parsed, NodeKind.PARAGRAPH)] == [
        "The diagram below shows a reinforcing loop."
    ]


@pytest.mark.parametrize(
    ("rows", "ordered"),
    [
        ([[(72, f"\u2022 {item}")] for item in ITEMS], False),
        ([[(72, f"\u2013 {item}")] for item in ITEMS], False),
        ([[(72, f"\u25e6 {item}")] for item in ITEMS], False),
        ([[(72, f"\u25aa {item}")] for item in ITEMS], False),
        ([[(72, f"* {item}")] for item in ITEMS], False),
        ([[(72, f"{n}. {item}")] for n, item in enumerate(ITEMS, 1)], True),
        ([[(72, f"{n}) {item}")] for n, item in zip("abc", ITEMS, strict=True)], True),
        ([[(72, "\u2022"), (86, item)] for item in ITEMS], False),
        ([[(72, f"\u2022{item}")] for item in ITEMS], False),
        ([[(72, "\u2022\u00a0" + item.replace(" ", "\u00a0"))] for item in ITEMS], False),
    ],
    ids=["bullet", "en-dash", "white-bullet", "square", "asterisk", "numbered", "lettered",
         "glyph-drawn-apart", "no-space", "non-breaking-spaces"],
)  # fmt: skip
def test_marked_lines_become_one_list_block(tmp_path: Path, rows, ordered: bool):
    parsed = parse_pdf(list_pdf(tmp_path / "l.pdf", rows), slug="l", media_dir=tmp_path)

    [items] = of_kind(parsed, NodeKind.LIST)
    assert items.meta == {"items": ITEMS, "ordered": ordered}
    assert [p.text for p in of_kind(parsed, NodeKind.PARAGRAPH)] == [
        "Stocks respond to flows in three ways."
    ]


@pytest.mark.parametrize(
    ("options", "caption"),
    [
        ({"connected": True, "caption": True}, CAPTION),
        ({"connected": True, "caption": False, "label": LONG_LABEL}, None),
        ({"connected": False, "caption": True, "label": LONG_LABEL}, CAPTION),
        ({"connected": False, "caption": False}, None),
    ],
    ids=["labelled-diagram", "connector-only", "caption-only", "short-label-only"],
)
def test_boxes_of_a_diagram_are_a_figure_not_an_aside(
    tmp_path: Path, options: dict[str, Any], caption: str | None
):
    path = boxed_diagram_pdf(tmp_path / "b.pdf", **options)
    parsed = parse_pdf(path, slug="b", media_dir=tmp_path)

    assert of_kind(parsed, NodeKind.ASIDE) == []
    [figure] = of_kind(parsed, NodeKind.FIGURE)
    assert figure.meta["caption"] == caption
    assert (tmp_path / figure.meta["image_path"]).read_bytes().startswith(b"\x89PNG")
    assert [p.text for p in of_kind(parsed, NodeKind.PARAGRAPH)] == [
        "The stock and its inflow are drawn below."
    ]


def test_text_decorations_drawn_as_vectors_are_not_figures(tmp_path: Path):
    """Bullet dots and link underlines sit beside their text; a lone arrow is no formula."""
    parsed = parse_pdf(decorated_text_pdf(tmp_path / "t.pdf"), slug="t", media_dir=tmp_path)

    assert of_kind(parsed, NodeKind.FIGURE) == []
    assert of_kind(parsed, NodeKind.MATH) == []
    text = " ".join(n.text for n in parsed.walk() if not n.kind.is_container)
    assert "Ownership of results" in text
    assert "Common Pitfalls" in text

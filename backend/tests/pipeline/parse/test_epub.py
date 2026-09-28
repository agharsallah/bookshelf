"""EPUB books end in the same tree and block kinds as PDFs, from the book's own structure."""

import zipfile
from pathlib import Path

import pytest

from app.models.enums import NodeKind
from app.pipeline.parse import ParsedDocument, ParseError, parse_file
from app.pipeline.parse.epub import parse_epub
from tests.pipeline.parse.conftest import of_kind, outline
from tests.pipeline.parse.epub_builders import (
    CODE,
    book_epub,
    epub2_book,
    opf,
    page,
    untitled_book,
    write_epub,
)


@pytest.fixture(scope="module")
def media_root(tmp_path_factory: pytest.TempPathFactory) -> Path:
    return tmp_path_factory.mktemp("epub-media")


@pytest.fixture(scope="module")
def book(tmp_path_factory: pytest.TempPathFactory, media_root: Path) -> ParsedDocument:
    path = book_epub(tmp_path_factory.mktemp("epub") / "systems.epub")
    return parse_epub(path, slug="systems", media_dir=media_root)


def _texts(parsed: ParsedDocument, kind: NodeKind) -> list[str]:
    return [n.text or "" for n in of_kind(parsed, kind)]


# --- package ------------------------------------------------------------------------------


def test_metadata_comes_from_the_package_document(book: ParsedDocument):
    assert (book.title, book.authors, book.year, book.language) == (
        "Thinking in Systems", ["Donella Meadows"], 2008, "en",
    )  # fmt: skip


def test_nav_entries_become_chapters_and_sections_at_their_targets(book: ParsedDocument):
    assert (book.tier, book.needs_review) == (1, False)
    assert outline(book) == [
        ("ch01", "Chapter 1 Stocks"),
        ("ch01/s01", "1.1 Flows"),
        ("ch01/s01/ss01", "Delays"),  # an <h3> the nav leaves out, nested under its entry
        ("ch02", "Chapter 2 Loops"),
    ]
    stocks = next(n for n in book.walk() if n.anchor == "ch01")
    assert stocks.children[0].text.startswith("A stock is the memory")


def test_heading_lines_that_repeat_the_entry_are_consumed(book: ParsedDocument):
    # `Chapter 1 Stocks`, `1.1 Flows` and the split `Chapter 2` / `Loops` are not repeated.
    paragraphs = _texts(book, NodeKind.PARAGRAPH)
    assert not any(t in ("Chapter 1 Stocks", "1.1 Flows", "Chapter 2", "Loops") for t in paragraphs)


def test_navigation_bars_and_the_cover_are_not_content(book: ParsedDocument):
    everything = " ".join(n.text or "" for n in book.walk())
    assert "Next: Chapter 2" not in everything
    assert all(f.meta["alt"] != "cover" for f in of_kind(book, NodeKind.FIGURE))
    assert not any(n.meta.get("front_matter") for n in book.walk())


# --- blocks -------------------------------------------------------------------------------


def test_footnote_is_lifted_out_and_attached_to_the_citing_paragraph(book: ParsedDocument):
    cited = next(n for n in of_kind(book, NodeKind.PARAGRAPH) if "memory" in (n.text or ""))
    assert cited.text == "A stock is the memory of a system. It changes only through flows."
    assert cited.meta["footnotes"] == [{"marker": "1", "text": "Meadows calls it a buffer."}]
    assert not any("buffer" in t for t in _texts(book, NodeKind.PARAGRAPH))


def test_code_list_and_table_keep_their_structure(book: ParsedDocument):
    (code,) = of_kind(book, NodeKind.CODE)
    assert (code.text, code.meta["language"]) == (CODE, "python")
    (items,) = of_kind(book, NodeKind.LIST)
    assert items.meta == {"items": ["inflows fill the stock", "outflows drain the stock"],
                          "ordered": False}  # fmt: skip
    (table,) = of_kind(book, NodeKind.TABLE)
    assert table.meta["table"] == {
        "header": ["Name", "Kind"], "rows": [["Bathtub", "stock"], ["Faucet", "flow"]],
    }  # fmt: skip


def test_mathml_becomes_tex_for_display_and_inline_math(book: ParsedDocument):
    (display,) = of_kind(book, NodeKind.MATH)
    assert display.meta == {"inline": False, "latex": r"\frac{dS}{dt} = x^2", "image_path": None}
    assert "The rate is \\(\\sqrt{k}\\) per year." in _texts(book, NodeKind.PARAGRAPH)


def test_blockquote_and_aside_with_its_heading_as_label(book: ParsedDocument):
    assert _texts(book, NodeKind.QUOTE) == ["Feedback is everywhere."]
    (aside,) = of_kind(book, NodeKind.ASIDE)
    assert (aside.text, aside.meta["label"]) == ("Balancing loops seek a goal.", "Key idea")


def test_figures_are_saved_under_their_anchor(book: ParsedDocument, media_root: Path):
    tub, svg = of_kind(book, NodeKind.FIGURE)
    assert (tub.text, tub.meta["caption"], tub.meta["src"]) == (
        "Figure 1.1 The bathtub", "Figure 1.1 The bathtub", "OEBPS/images/tub.png",
    )  # fmt: skip
    assert tub.meta["image_path"] == f"systems/{tub.anchor}.png"
    assert (media_root / tub.meta["image_path"]).read_bytes().startswith(b"\x89PNG")
    # an inline <svg> is rasterised: the media endpoint never serves SVG
    assert svg.meta["image_path"] == f"systems/{svg.anchor}.png"
    assert (media_root / svg.meta["image_path"]).read_bytes().startswith(b"\x89PNG")


def test_page_breaks_give_print_page_numbers(book: ParsedDocument):
    assert book.page_count == 12
    first = next(n for n in of_kind(book, NodeKind.PARAGRAPH) if "memory" in (n.text or ""))
    assert first.page_from is None
    assert of_kind(book, NodeKind.CODE)[0].page_from == 12  # after the break
    assert of_kind(book, NodeKind.CHAPTER)[0].page_to == 12


# --- other shapes -------------------------------------------------------------------------


def test_epub2_ncx_parts_and_endnotes_outside_the_reading_order(tmp_path: Path):
    parsed = parse_epub(epub2_book(tmp_path / "limits.epub"), slug="l", media_dir=tmp_path)

    assert outline(parsed) == [("pt01", "Part I Foundations"), ("pt01/ch01", "The Basics")]
    assert "Opening words for the part." in _texts(parsed, NodeKind.PARAGRAPH)  # &nbsp; parsed
    cited = next(n for n in of_kind(parsed, NodeKind.PARAGRAPH) if "starts" in (n.text or ""))
    assert cited.meta["footnotes"] == [{"marker": "1", "text": "From the 1972 report."}]
    assert not of_kind(parsed, NodeKind.LIST)  # the endnotes document is never read as text


def test_without_a_table_of_contents_headings_rank_the_tree(tmp_path: Path):
    parsed = parse_epub(untitled_book(tmp_path / "notes.epub"), slug="n", media_dir=tmp_path)

    assert (parsed.tier, parsed.needs_review) == (2, True)
    assert outline(parsed) == [("ch01", "Stocks"), ("ch01/s01", "Flows"), ("ch02", "Loops")]


def test_parse_file_picks_the_epub_parser_by_suffix(tmp_path: Path):
    parsed = parse_file(book_epub(tmp_path / "b.EPUB"), slug="b", media_dir=tmp_path)
    assert parsed.title == "Thinking in Systems"


# --- failures -----------------------------------------------------------------------------


def test_a_file_that_is_not_a_zip_is_a_parse_error(tmp_path: Path):
    bad = tmp_path / "bad.epub"
    bad.write_bytes(b"%PDF-1.7 not an epub")
    with pytest.raises(ParseError, match="cannot open EPUB"):
        parse_epub(bad, slug="x", media_dir=tmp_path)


def test_drm_protected_content_is_a_parse_error(tmp_path: Path):
    path = book_epub(tmp_path / "drm.epub")
    with zipfile.ZipFile(path, "a") as archive:
        archive.writestr(
            "META-INF/encryption.xml",
            """<encryption
          xmlns="urn:oasis:names:tc:opendocument:xmlns:container"
          xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData>
          <enc:EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/>
          <enc:CipherData><enc:CipherReference URI="OEBPS/ch1.xhtml"/></enc:CipherData>
          </enc:EncryptedData></encryption>""",
        )
    with pytest.raises(ParseError, match="DRM"):
        parse_epub(path, slug="x", media_dir=tmp_path)


def test_font_obfuscation_is_not_drm(tmp_path: Path):
    path = book_epub(tmp_path / "fonts.epub")
    with zipfile.ZipFile(path, "a") as archive:
        archive.writestr(
            "META-INF/encryption.xml",
            """<encryption
          xmlns="urn:oasis:names:tc:opendocument:xmlns:container"
          xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData>
          <enc:EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/>
          </enc:EncryptedData></encryption>""",
        )
    assert parse_epub(path, slug="x", media_dir=tmp_path).tier == 1


def test_a_book_without_text_is_a_parse_error(tmp_path: Path):
    manifest = '<item id="a" href="a.xhtml" media-type="application/xhtml+xml"/>'
    path = write_epub(tmp_path / "empty.epub", {
        "OEBPS/content.opf": opf("<dc:title>Empty</dc:title>", manifest, '<itemref idref="a"/>'),
        "OEBPS/a.xhtml": page("<div>  </div>"),
    })  # fmt: skip
    with pytest.raises(ParseError, match="no text"):
        parse_epub(path, slug="x", media_dir=tmp_path)

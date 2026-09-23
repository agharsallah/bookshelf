"""Fixture PDFs generated with PyMuPDF itself: small, deterministic, built in milliseconds.

`book_pdf()` is a three-page book exercising every block kind:

    page 1  running header + page number · `Chapter 1 Stocks` · a hyphenated paragraph
            `1.1 Flows` · a Courier listing + `Listing 1.1` · two bullets · a centred
            formula · a ruled 3x3 table + `Table 1.1`
    page 2  an image + `Figure 1.1` · a shaded `Key point` box · `Chapter 2 Loops`
            a paragraph + a small-type footnote at the page bottom
    page 3  two columns, two paragraphs each
"""

# mypy: disallow-untyped-calls=False

from pathlib import Path

import pymupdf

HEADER = "Thinking in Systems"
TOC = [[1, "Chapter 1 Stocks", 1], [2, "1.1 Flows", 1], [1, "Chapter 2 Loops", 2]]
CODE = "def flow(stock):\n    return stock * 0.5"
TABLE_HEADER = ["Name", "Kind", "Rate"]
TABLE_ROWS = [["Bathtub", "stock", "0.5"], ["Faucet", "flow", "2.0"]]
LEFT = ["Left column opens here.", "Left column closes here."]
RIGHT = ["Right column opens here.", "Right column closes here."]


def _text(page: pymupdf.Page, x: float, y: float, text: str, size: float = 11, **kw) -> None:
    page.insert_text((x, y), text, fontsize=size, **kw)


def _book_page(doc: pymupdf.Document, number: int) -> pymupdf.Page:
    page = doc.new_page()  # A4: 595 x 842
    _text(page, 72, 40, HEADER, 9)
    _text(page, 290, 810, str(number), 9)
    return page


def _page_one(page: pymupdf.Page) -> None:
    _text(page, 72, 100, "Chapter 1 Stocks", 20, fontname="hebo")
    _text(page, 72, 140, "A stock is the memory of a system and this opening para-")
    _text(page, 72, 154, "graph wraps across two lines.")
    _text(page, 72, 190, "1.1 Flows", 14, fontname="hebo")
    for i, line in enumerate(CODE.split("\n")):
        _text(page, 72, 220 + 12 * i, line, 10, fontname="cour")
    _text(page, 72, 254, "Listing 1.1 A flow function", 10)
    _text(page, 72, 284, "\u2022 inflows fill the stock", 11)
    _text(page, 72, 298, "\u2022 outflows drain the stock", 11)
    _text(page, 250, 330, "E = m \u00d7 c^2")
    for r, row in enumerate([TABLE_HEADER, *TABLE_ROWS]):
        for c, cell in enumerate(row):
            rect = pymupdf.Rect(72 + c * 100, 360 + r * 20, 172 + c * 100, 380 + r * 20)
            page.draw_rect(rect, color=(0, 0, 0), width=0.5)
            _text(page, rect.x0 + 4, rect.y1 - 6, cell, 10)
    _text(page, 72, 440, "Table 1.1 Stocks and their rates", 10)


def _page_two(page: pymupdf.Page) -> None:
    pixmap = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 16, 16), False)
    pixmap.clear_with(120)
    page.insert_image(pymupdf.Rect(72, 80, 272, 200), pixmap=pixmap)
    _text(page, 72, 215, "Figure 1.1 A stock drawn as a bathtub", 10)
    page.draw_rect(pymupdf.Rect(60, 250, 500, 320), color=(0, 0, 0), fill=(0.9, 0.9, 0.9))
    _text(page, 72, 270, "Key point", fontname="hebo")
    _text(page, 72, 290, "Stocks change only through flows.")
    _text(page, 72, 360, "Chapter 2 Loops", 20, fontname="hebo")
    _text(page, 72, 400, "A loop feeds back on itself.")
    _text(page, 72, 760, "1 Meadows calls these feedback loops.", 8)


def _page_three(page: pymupdf.Page) -> None:
    for x, sentences in ((72, LEFT), (320, RIGHT)):
        for i, sentence in enumerate(sentences):
            y = 80 + i * 60
            _text(page, x, y, sentence)
            _text(page, x, y + 14, "More words follow on.")


def book_pdf(path: Path, *, toc: bool = True) -> Path:
    doc = pymupdf.open()
    for number, fill in enumerate((_page_one, _page_two, _page_three), 1):
        fill(_book_page(doc, number))
    if toc:
        doc.set_toc(TOC)
    doc.set_metadata({"title": HEADER, "author": "Meadows, Donella", "creationDate": "D:2008"})
    doc.save(path)
    return path


def diagram_pdf(path: Path) -> Path:
    """A vector diagram (boxes, arrows, a circle) with a caption and a label inside it."""
    doc = pymupdf.open()
    page = doc.new_page()
    _text(page, 72, 80, "Chapter 1 Loops", 20, fontname="hebo")
    _text(page, 72, 110, "The diagram below shows a reinforcing loop.")
    page.draw_rect(pymupdf.Rect(100, 150, 180, 190), color=(0, 0, 0))
    page.draw_rect(pymupdf.Rect(300, 150, 380, 190), color=(0, 0, 0))
    page.draw_line((180, 170), (300, 170), color=(0, 0, 0))
    page.draw_circle((240, 235), 25, color=(0, 0, 0))
    _text(page, 232, 240, "R1", 9)
    _text(page, 72, 310, "Figure 2.1 A reinforcing loop", 10)
    doc.save(path)
    return path


def scanned_pdf(path: Path) -> Path:
    """A page that is only an image of text, like a scan: no text layer at all."""
    source = pymupdf.open()
    page = source.new_page(width=300, height=200)
    _text(page, 20, 60, "The quick brown fox jumps over the lazy dog.", 11)
    image = page.get_pixmap(dpi=150)
    doc = pymupdf.open()
    doc.new_page(width=300, height=200).insert_image(pymupdf.Rect(0, 0, 300, 200), pixmap=image)
    doc.save(path)
    return path

# mypy: disallow-untyped-calls=False
"""Render a `Reading` to PDF: a cover, a linked contents with page numbers, an outline.

PyMuPDF's Story lays out the HTML from `app.reading.markup`. Layout runs twice: the
first pass records the page each piece starts on, the second prints those numbers in
the contents (same text height, so nothing moves). Internal links (`#id`) become page
links; the outline is grouped like the contents. A running head (the book on the left,
the current part on the right) and page numbers are drawn afterwards, off the cover.
"""

from typing import Any, cast

import pymupdf

from app.reading.markup import reading_html
from app.reading.model import Reading

_INK = "#2a2520"
_MUTED = "#6b6358"
_ACCENT = "#8a4b22"
_NAVY = "#1d2b3a"
_PAPER = "#f7f3ec"
_RULE = "#ddd3c4"

_CSS = f"""
body {{ font-family: serif; font-size: 10.5pt; line-height: 1.55; color: {_INK}; }}
h1 {{ font-family: serif; font-size: 30pt; line-height: 1.12; color: {_NAVY};
      margin: 0 0 10pt; }}
h2 {{ font-family: serif; font-size: 19pt; line-height: 1.2; color: {_NAVY}; margin: 0 0 6pt; }}
h3 {{ font-family: sans-serif; font-size: 11.5pt; color: {_NAVY}; margin: 16pt 0 4pt;
      padding-bottom: 2pt; border-bottom: 0.5pt solid {_RULE}; }}
h4 {{ font-family: sans-serif; font-size: 10.5pt; color: {_NAVY}; margin: 10pt 0 2pt; }}
p {{ margin: 0 0 7pt; text-align: justify; }}
ul, ol {{ margin: 0 0 8pt; padding-left: 15pt; }}
li {{ margin: 0 0 3pt; }}
a:link {{ color: {_NAVY}; text-decoration: none; }}
hr {{ border: 0; border-top: 1.2pt solid {_ACCENT}; margin: 14pt 0; width: 60pt; }}

.kicker {{ font-family: sans-serif; font-size: 8pt; color: {_ACCENT}; margin: 0 0 4pt;
           text-align: left; }}
.tone {{ font-family: sans-serif; font-size: 7.5pt; color: {_MUTED}; margin: 0 0 3pt;
         text-align: left; }}

#cover {{ padding-top: 150pt; }}
#cover .byline {{ font-size: 12pt; font-style: italic; color: {_MUTED}; text-align: left; }}
#cover .deck {{ font-size: 13pt; line-height: 1.45; color: {_INK}; text-align: left; }}
#cover .meta {{ font-family: sans-serif; font-size: 8.5pt; color: {_MUTED}; margin-top: 24pt; }}

#contents {{ page-break-before: always; }}
#contents h2 {{ margin-bottom: 14pt; }}
.group {{ font-family: sans-serif; font-size: 8pt; color: {_ACCENT}; margin: 14pt 0 2pt; }}
table.toc {{ width: 100%; border-collapse: collapse; margin: 0; font-size: 10.5pt; }}
table.toc td {{ border: 0; border-bottom: 0.4pt dotted {_RULE}; padding: 4pt 0; }}
table.toc a:link {{ color: {_INK}; }}
.toc-kicker {{ font-family: sans-serif; font-size: 7pt; color: {_MUTED}; }}
.toc-page {{ text-align: right; vertical-align: bottom; font-family: sans-serif;
             font-size: 9.5pt; color: {_MUTED}; }}
.empty {{ color: {_MUTED}; font-style: italic; }}

.piece {{ page-break-before: always; }}
.standfirst {{ font-size: 12pt; line-height: 1.45; font-style: italic; color: {_MUTED};
               margin: 0 0 12pt; text-align: left; }}
.bridge {{ background-color: {_PAPER}; border-left: 2.5pt solid {_ACCENT};
           padding: 9pt 11pt 3pt; margin: 6pt 0 14pt; }}
.notes-rule {{ font-family: sans-serif; font-size: 7.5pt; color: {_MUTED}; margin: 18pt 0 0;
               padding-top: 6pt; border-top: 0.5pt solid {_RULE}; }}

.cite {{ font-family: sans-serif; font-size: 6.5pt; color: #9a9184; }}
.cite a:link {{ color: #9a9184; }}
.callout {{ padding: 8pt 10pt 2pt; margin: 8pt 0 10pt; border-left: 2.5pt solid {_NAVY};
            background-color: {_PAPER}; }}
.callout.insight, .callout.remember, .callout.tip {{ border-left-color: #2f6f4e; }}
.callout.caution, .callout.antipattern, .callout.warning {{ border-left-color: #9a3b2f; }}
.callout p {{ text-align: left; }}
blockquote {{ margin: 10pt 12pt 10pt 6pt; padding-left: 10pt; border-left: 1.5pt solid {_RULE};
              font-style: italic; color: #3d3832; }}
blockquote .by {{ font-style: normal; font-size: 9pt; color: {_MUTED}; }}
.definition {{ text-align: left; }}
.diagram {{ background-color: {_PAPER}; padding: 8pt 10pt 2pt; margin: 8pt 0; }}
.edge {{ font-style: italic; color: {_MUTED}; }}
code, pre {{ font-family: monospace; font-size: 9pt; }}
pre {{ background-color: {_PAPER}; padding: 8pt; white-space: pre-wrap; }}
table {{ border-collapse: collapse; width: 100%; margin: 8pt 0 4pt; font-size: 9.5pt; }}
th, td {{ border: 0.4pt solid {_RULE}; padding: 3pt 5pt; text-align: left; vertical-align: top; }}
th {{ font-family: sans-serif; background-color: {_PAPER}; }}
.caption {{ font-family: sans-serif; font-size: 8.5pt; color: {_MUTED}; text-align: left; }}
.math {{ font-family: monospace; font-size: 9.5pt; text-align: center; }}
.see {{ font-family: sans-serif; font-size: 9pt; color: {_MUTED}; margin-top: 16pt;
        padding-top: 6pt; border-top: 0.5pt solid {_RULE}; text-align: left; }}
"""

_MEDIABOX = pymupdf.paper_rect("a4")
_LEFT, _RIGHT = 62.0, _MEDIABOX.width - 62.0
_WHERE = pymupdf.Rect(_LEFT, 64, _RIGHT, _MEDIABOX.height - 60)
_HEAD_INK = (0.42, 0.39, 0.35)


def render_pdf(reading: Reading) -> bytes:
    """The reading as PDF bytes, with a paged contents, an outline and running heads."""
    pages, _ = _layout(reading, {})
    starts, document = _layout(reading, pages)
    document.set_toc(_outline(reading, starts))
    document.set_metadata(
        {"title": reading.title, "author": reading.byline, "subject": reading.edition}
    )
    _decorate(document, reading, starts)
    return cast(bytes, document.tobytes(garbage=3, deflate=True))


def _layout(reading: Reading, pages: dict[str, int]) -> tuple[dict[str, int], pymupdf.Document]:
    """Lay the reading out once: the page each section id starts on, and the document."""
    story = pymupdf.Story(reading_html(reading, pages), user_css=_CSS)
    starts: dict[str, int] = {}

    def record(position: Any) -> None:
        if position.id and position.open_close & 1 and position.id not in starts:
            starts[position.id] = position.page_num

    document = story.write_with_links(_rect, positionfn=record)
    return starts, document


def _rect(rect_num: int, filled: Any) -> tuple[Any, Any, None]:
    del rect_num, filled
    return _MEDIABOX, _WHERE, None


def _outline(reading: Reading, starts: dict[str, int]) -> list[list[Any]]:
    """Cover, contents, then each group with its pieces beneath it."""
    outline: list[list[Any]] = [[1, reading.title, 1]]
    if "contents" in starts:
        outline.append([1, "Contents", starts["contents"]])
    group = None
    for piece in reading.pieces:
        page = starts.get(piece.id)
        if page is None:
            continue
        if piece.group != group:
            group = piece.group
            outline.append([1, group, page])
        outline.append([2, piece.title, page])
    return outline


def _decorate(document: pymupdf.Document, reading: Reading, starts: dict[str, int]) -> None:
    """Running head and page number on every page but the cover."""
    opening = sorted(
        (start, piece.title) for piece in reading.pieces if (start := starts.get(piece.id))
    )
    contents_page = starts.get("contents", 2)
    for index in range(1, document.page_count):
        page = document[index]
        number = index + 1
        current = "Contents" if number == contents_page else ""
        for start, title in opening:
            if start <= number:
                current = title
        width = page.rect.width
        _text(page, pymupdf.Rect(_LEFT, 30, width / 2, 46), reading.title, pymupdf.TEXT_ALIGN_LEFT)
        _text(page, pymupdf.Rect(width / 2, 30, _RIGHT, 46), current, pymupdf.TEXT_ALIGN_RIGHT)
        page.draw_line((_LEFT, 47), (_RIGHT, 47), color=(0.87, 0.83, 0.77), width=0.4)
        bottom = page.rect.height
        footer = pymupdf.Rect(_LEFT, bottom - 42, _RIGHT, bottom - 26)
        _text(page, footer, str(number), pymupdf.TEXT_ALIGN_CENTER)


def _text(page: pymupdf.Page, rect: pymupdf.Rect, text: str, align: int) -> None:
    """One line of running text, shortened to fit its box."""
    fitted = text
    while fitted and pymupdf.get_text_length(fitted, fontname="helv", fontsize=7.5) > rect.width:
        fitted = fitted[:-2].rstrip() + "…" if len(fitted) > 2 else ""
    page.insert_textbox(rect, fitted, fontsize=7.5, fontname="helv", color=_HEAD_INK, align=align)

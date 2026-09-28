"""Typed boundary around the PyMuPDF calls the parser uses.

PyMuPDF ships partial annotations, so strict mypy rejects calls into its untyped parts.
Every such call lives here, returning plain Python values; the rest of the parser works
on tuples and dicts and never touches untyped API.
"""

# mypy: disallow-untyped-calls=False

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pymupdf

from app.pipeline.parse.model import Bbox
from app.pipeline.parse.pdf.geometry import rounded

pymupdf.no_recommend_layout()  # find_tables() otherwise prints an ad to stdout

# Ligatures expanded (no TEXT_PRESERVE_LIGATURES), images left to get_image_info().
TEXT_FLAGS = pymupdf.TEXT_PRESERVE_WHITESPACE | pymupdf.TEXT_MEDIABOX_CLIP
SUPERSCRIPT = pymupdf.TEXT_FONT_SUPERSCRIPT
ITALIC = pymupdf.TEXT_FONT_ITALIC
MONOSPACED = pymupdf.TEXT_FONT_MONOSPACED
BOLD = pymupdf.TEXT_FONT_BOLD


@dataclass(slots=True)
class Table:
    bbox: Bbox
    rows: list[list[str | None]]
    header: list[str] | None  # set only when MuPDF found the header outside the grid


@dataclass(slots=True)
class Drawing:
    bbox: Bbox
    items: int
    box: bool  # a single stroked or filled rectangle


def open_pdf(path: Path) -> pymupdf.Document:
    return pymupdf.open(path)


def page_text_dict(page: pymupdf.Page, textpage: pymupdf.TextPage | None) -> dict[str, Any]:
    result: dict[str, Any] = page.get_text("dict", flags=TEXT_FLAGS, textpage=textpage)
    return result


def plain_text(page: pymupdf.Page) -> str:
    return str(page.get_text("text"))


def ocr_textpage(page: pymupdf.Page, dpi: int = 200) -> pymupdf.TextPage:
    """Full-page Tesseract OCR (tier 3). Raises `RuntimeError` when Tesseract is missing."""
    textpage: pymupdf.TextPage = page.get_textpage_ocr(dpi=dpi, full=True)
    return textpage


def tables(page: pymupdf.Page) -> list[Table]:
    found = []
    for table in page.find_tables().tables:
        external = table.header.external
        found.append(
            Table(
                bbox=rounded(table.bbox),
                rows=table.extract(),
                header=list(table.header.names) if external else None,
            )
        )
    return found


def drawings(page: pymupdf.Page) -> list[Drawing]:
    out = []
    for path in page.get_drawings():
        items = path.get("items") or []
        rect = rounded(path["rect"])
        painted = path.get("fill") is not None or path.get("color") is not None
        box = len(items) == 1 and items[0][0] in ("re", "qu") and painted
        out.append(Drawing(bbox=rect, items=len(items), box=box))
    return out


def image_boxes(page: pymupdf.Page) -> list[Bbox]:
    return [rounded(info["bbox"]) for info in page.get_image_info()]


def page_box(page: pymupdf.Page) -> Bbox:
    return rounded(page.rect)


def save_crop(page: pymupdf.Page, bbox: Bbox, target: Path, dpi: int = 144) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    page.get_pixmap(clip=pymupdf.Rect(bbox), dpi=dpi).save(target)


def toc(doc: pymupdf.Document) -> list[tuple[int, str, int]]:
    return [(int(lvl), str(title), int(page)) for lvl, title, page, *_ in doc.get_toc()]


def metadata(doc: pymupdf.Document) -> dict[str, str]:
    return {str(k): str(v) for k, v in (doc.metadata or {}).items() if v}


def page_size(page: pymupdf.Page) -> tuple[float, float]:
    return float(page.rect.width), float(page.rect.height)


def pages(doc: pymupdf.Document) -> list[pymupdf.Page]:
    return [doc.load_page(i) for i in range(doc.page_count)]


def image_to_png(data: bytes, target: Path, *, svg: bool, dpi: int = 144) -> None:
    """Rasterise an SVG (or any image MuPDF reads that browsers may not) to a PNG file.

    Used by the EPUB parser, whose figures are files in the book rather than page regions.
    Raises `RuntimeError` / `ValueError` for data MuPDF cannot read.
    """
    target.parent.mkdir(parents=True, exist_ok=True)
    if not svg:
        pymupdf.Pixmap(data).save(target)
        return
    with pymupdf.open(stream=data, filetype="svg") as doc:
        doc.load_page(0).get_pixmap(dpi=dpi).save(target)

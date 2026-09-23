"""PDF → `ParsedDocument`, following the §8 tier ladder.

    text chars per page < 200   → tier 3: Tesseract OCR, then tier 2   (needs_review)
    embedded outline            → tier 1: chapters/sections from the outline
    otherwise                   → tier 2: headings by font size/weight  (needs_review)

Whatever the tier: furniture is stripped, regions (tables, figures, boxes) are classified
before prose, pages are read column by column, and an `outline_override` (§8 manual
fix-up) replaces the detected chapter/section boundaries.
"""

import re
from pathlib import Path

import pymupdf

from app.pipeline.parse.anchors import assign_anchors
from app.pipeline.parse.model import ParsedDocument, ParsedNode, ParseError
from app.pipeline.parse.override import OverrideChapter
from app.pipeline.parse.pdf import mupdf
from app.pipeline.parse.pdf.furniture import strip_furniture
from app.pipeline.parse.pdf.headings import (
    Item,
    Placed,
    body_size,
    detect_headings,
    override_entries,
    place_outline,
    toc_entries,
)
from app.pipeline.parse.pdf.layout import Block, extract_blocks, reading_order, text_area
from app.pipeline.parse.pdf.prose import (
    Footnote,
    attach_footnotes,
    build_leaves,
    finish_code,
    split_footnotes,
)
from app.pipeline.parse.pdf.regions import Region, classify_regions
from app.pipeline.parse.tree import build_tree

SCANNED_CHARS_PER_PAGE = 200
_YEAR = re.compile(r"D:(\d{4})")


def _chars(blocks: list[Block]) -> int:
    return sum(len(line.text.strip()) for block in blocks for line in block.lines)


def _authors(raw: str) -> list[str]:
    parts = [p.strip() for p in re.split(r";|&|\band\b", raw) if p.strip()]
    if len(parts) == 1 and parts[0].count(",") == 1:
        last, first = (s.strip() for s in parts[0].split(","))
        if " " not in last and " " not in first:
            return [f"{first} {last}"]  # `Meadows, Donella`
    return [a.strip() for p in parts for a in p.split(",") if a.strip()]


def _describe(doc: pymupdf.Document, parsed: ParsedDocument) -> None:
    meta = mupdf.metadata(doc)
    title = meta.get("title", "").strip()
    if title and not title.lower().endswith((".pdf", ".doc", ".docx")):
        parsed.title = title
    parsed.authors = _authors(meta.get("author", ""))
    if year := _YEAR.match(meta.get("creationDate", "")):
        parsed.year = int(year.group(1))


def _read_pages(doc_pages: list[pymupdf.Page]) -> tuple[list[list[Block]], bool]:
    """Every page's blocks, OCR'ing near-empty pages when the document is scanned."""
    pages = [extract_blocks(page, i + 1) for i, page in enumerate(doc_pages)]
    total = sum(_chars(blocks) for blocks in pages)
    scanned = bool(pages) and total / len(pages) < SCANNED_CHARS_PER_PAGE
    if scanned:
        for i, page in enumerate(doc_pages):
            if _chars(pages[i]) < SCANNED_CHARS_PER_PAGE:
                pages[i] = extract_blocks(page, i + 1, mupdf.ocr_textpage(page))
    return pages, scanned


def _stream(
    doc_pages: list[pymupdf.Page], pages: list[list[Block]], *, scanned: bool, body: float
) -> tuple[list[Item], list[Footnote], list[str]]:
    """Regions and prose blocks of the whole document, in reading order."""
    area = text_area([b for blocks in pages for b in blocks])
    items: list[Item] = []
    notes: list[Footnote] = []
    warnings: list[str] = []
    for i, page in enumerate(doc_pages):
        width, height = mupdf.page_size(page)
        found = classify_regions(page, i + 1, pages[i], scanned=scanned)
        warnings.extend(found.warnings)
        prose, page_notes = split_footnotes(found.blocks, height, body)
        notes.extend(page_notes)
        mixed: list[Block | Region] = [*prose, *found.regions]
        ordered, columns = reading_order(mixed, lambda it: it.bbox, width, area)
        for item, column in zip(ordered, columns, strict=True):
            if isinstance(item, Block):
                item.column = column
                items.append(item)
            else:
                items.append(item.node)
    return items, notes, warnings


def _write_crops(
    doc_pages: list[pymupdf.Page], roots: list[ParsedNode], media_dir: Path, slug: str
) -> None:
    for root in roots:
        for node in root.walk():
            if node.crop is None:
                continue
            relative = Path(slug) / f"{node.anchor}.png"
            mupdf.save_crop(doc_pages[node.crop.page - 1], node.crop.bbox, media_dir / relative)
            node.meta["image_path"] = relative.as_posix()


def parse_pdf(
    path: Path,
    *,
    slug: str,
    media_dir: Path,
    outline_override: list[OverrideChapter] | None = None,
) -> ParsedDocument:
    """Parse a PDF; figure and display-math crops go to `media_dir/<slug>/<anchor>.png`."""
    try:
        doc = mupdf.open_pdf(path)
    except (pymupdf.FileDataError, pymupdf.EmptyFileError, RuntimeError) as exc:
        raise ParseError(f"cannot open PDF {path.name}: {exc}") from exc
    with doc:
        if doc.needs_pass:
            raise ParseError(f"{path.name} is password-protected")
        parsed = ParsedDocument(page_count=doc.page_count)
        _describe(doc, parsed)
        doc_pages = mupdf.pages(doc)
        pages, scanned = _read_pages(doc_pages)
        pages = strip_furniture(pages, [mupdf.page_size(p)[1] for p in doc_pages])
        body = body_size([b for blocks in pages for b in blocks])
        items, notes, parsed.warnings = _stream(doc_pages, pages, scanned=scanned, body=body)

        toc = mupdf.toc(doc)
        parsed.tier = 3 if scanned else 1 if toc else 2
        placed: list[Placed]
        if outline_override:
            placed = place_outline(items, override_entries(outline_override, doc.page_count))
        elif parsed.tier == 1:
            placed = place_outline(items, toc_entries(toc))
        else:
            placed, title = detect_headings(items, body)
            parsed.title = parsed.title or title
        parsed.needs_review = parsed.tier > 1 and not outline_override

        events, refs = build_leaves(placed)
        finish_code(events)
        attach_footnotes(events, notes, refs)
        parsed.children = build_tree(events)
        if not any(not n.kind.is_container for n in parsed.walk()):
            raise ParseError(f"no text could be extracted from {path.name}")
        assign_anchors(parsed.children)
        _write_crops(doc_pages, parsed.children, media_dir, slug)
    return parsed

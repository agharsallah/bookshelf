"""Book covers: the EPUB's own cover image, or a PDF's first page rendered, made on first
request and kept as `media_dir/<slug>/cover.<ext>`.

Only books have one: a paper's or an article's first page is text, and the library draws
a cloth cover for them instead. The cached file is remade when the source is newer, and a
re-parse prunes it with the document's other stale media (`prune_document_media`), so a
changed book never keeps an old cover.
"""

import posixpath
from pathlib import Path

from app.core.errors import NotFoundError
from app.models import Document
from app.models.enums import DocumentKind, Genre
from app.pipeline.parse.epub.package import open_package
from app.pipeline.parse.model import ParseError
from app.pipeline.parse.pdf.mupdf import open_pdf
from app.services.library import SourcePathError, resolve_source_path
from app.services.media import IMAGE_TYPES

COVER_STEM = "cover"
# Wide enough for a sharp face-out cover on a retina screen, small enough to stay light.
COVER_WIDTH = 640


def _no_cover() -> NotFoundError:
    return NotFoundError("This document has no cover.")


def _cached(folder: Path, source: Path) -> Path | None:
    for file in folder.glob(f"{COVER_STEM}.*"):
        if file.suffix.lower() in IMAGE_TYPES and file.stat().st_mtime >= source.stat().st_mtime:
            return file
    return None


def _epub_cover(source: Path, folder: Path) -> Path:
    try:
        package = open_package(source)
    except ParseError:
        raise _no_cover() from None
    try:
        if package.cover is None:
            raise _no_cover()
        suffix = posixpath.splitext(package.cover)[1].lower()
        if suffix not in IMAGE_TYPES:  # an SVG cover could carry script: never served
            raise _no_cover()
        data = package.read(package.cover)
    except ParseError:
        raise _no_cover() from None
    finally:
        package.archive.close()
    target = folder / f"{COVER_STEM}{suffix}"
    target.write_bytes(data)
    return target


def _pdf_cover(source: Path, folder: Path) -> Path:
    target = folder / f"{COVER_STEM}.png"
    try:
        with open_pdf(source) as doc:
            if doc.page_count == 0:
                raise _no_cover()
            page = doc.load_page(0)
            # 72 dpi is one pixel per point: scale the page's width to COVER_WIDTH pixels.
            page.get_pixmap(dpi=round(72 * COVER_WIDTH / max(page.rect.width, 1))).save(target)
    except (RuntimeError, ValueError):  # MuPDF's errors for a file it cannot read
        raise _no_cover() from None
    return target


def cover_file(document: Document, *, library_dir: Path, media_dir: Path) -> tuple[Path, str]:
    """The document's cover image and its media type; `NotFoundError` when it has none."""
    if document.genre != Genre.BOOK or document.kind not in (DocumentKind.PDF, DocumentKind.EPUB):
        raise _no_cover()
    try:
        source = resolve_source_path(library_dir, document.source_path)
    except SourcePathError:
        raise _no_cover() from None
    if not source.is_file():
        raise _no_cover()
    root = media_dir.resolve()
    folder = (root / document.slug).resolve()
    if folder == root or not folder.is_relative_to(root):
        raise _no_cover()
    cover = _cached(folder, source) if folder.is_dir() else None
    if cover is None:
        folder.mkdir(parents=True, exist_ok=True)
        for stale in folder.glob(f"{COVER_STEM}.*"):
            stale.unlink()
        make = _epub_cover if document.kind == DocumentKind.EPUB else _pdf_cover
        cover = make(source, folder)
    return cover, IMAGE_TYPES[cover.suffix.lower()]

"""Stage 1 `parse`: original file → document tree of anchored blocks (§7, §8).

    parsed = parse_file(path, slug="meadows-systems", media_dir=settings.media_dir)
    store_tree(session, document, parsed)

Parsers are pure (file in, `ParsedDocument` out; the PDF and EPUB parsers also write figure
images under `media_dir`); `store_tree` is the only part that touches the database.
"""

from pathlib import Path

from app.pipeline.parse.epub import parse_epub
from app.pipeline.parse.html import parse_html
from app.pipeline.parse.markdown import parse_markdown
from app.pipeline.parse.model import ParsedDocument, ParsedNode, ParseError
from app.pipeline.parse.override import OUTLINE_OVERRIDE, OverrideChapter, load_override
from app.pipeline.parse.pdf import parse_pdf
from app.pipeline.parse.store import store_tree

PDF_SUFFIXES = frozenset({".pdf"})
EPUB_SUFFIXES = frozenset({".epub"})
HTML_SUFFIXES = frozenset({".html", ".htm"})
MARKDOWN_SUFFIXES = frozenset({".md", ".markdown"})
SUPPORTED_SUFFIXES = PDF_SUFFIXES | EPUB_SUFFIXES | HTML_SUFFIXES | MARKDOWN_SUFFIXES


def parse_file(
    path: Path,
    *,
    slug: str,
    media_dir: Path,
    outline_override: list[OverrideChapter] | None = None,
) -> ParsedDocument:
    """Pick the parser by suffix. Raises `ParseError` for unreadable or unsupported input."""
    suffix = path.suffix.lower()
    if suffix not in SUPPORTED_SUFFIXES:
        raise ParseError(f"unsupported file type {suffix or '(none)'}")
    if not path.is_file():
        raise ParseError(f"file not found: {path.name}")
    if suffix in PDF_SUFFIXES:
        return parse_pdf(path, slug=slug, media_dir=media_dir, outline_override=outline_override)
    if suffix in EPUB_SUFFIXES:
        return parse_epub(path, slug=slug, media_dir=media_dir)
    if suffix in HTML_SUFFIXES:
        return parse_html(path.read_bytes())
    return parse_markdown(path.read_text(encoding="utf-8", errors="replace"))


__all__ = [
    "OUTLINE_OVERRIDE",
    "SUPPORTED_SUFFIXES",
    "OverrideChapter",
    "ParseError",
    "ParsedDocument",
    "ParsedNode",
    "load_override",
    "parse_file",
    "store_tree",
]

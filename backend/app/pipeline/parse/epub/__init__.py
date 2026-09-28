"""EPUB → `ParsedDocument`: the book's own structure, not a layout guess.

    table of contents (nav / NCX)  → tier 1: chapters and sections at their targets
    no table of contents           → tier 2: headings by `h1`…`h6` rank (needs_review)

Content documents are walked in spine order into the same block kinds as every other
format (`content.Walker`); footnotes are lifted out of the flow and attached to the
leaf that cites them (`notes`); MathML becomes TeX. Figures are copied out of the book
to `media_dir/<slug>/<anchor>.<ext>`, SVG (and odd raster formats) rasterised to PNG,
since the media endpoint never serves SVG. Print page numbers come from EPUB 3
`pagebreak` markers when the book has them; otherwise nodes have no pages, like articles.

An `outline_override` is page-based and does not apply: EPUB outlines come from the book.
"""

from pathlib import Path

from app.pipeline.parse.anchors import assign_anchors
from app.pipeline.parse.dom import Element, parse_html
from app.pipeline.parse.epub.content import ImageSource, Targets, Walker
from app.pipeline.parse.epub.notes import Notes
from app.pipeline.parse.epub.package import Package, TocEntry, open_package
from app.pipeline.parse.model import Heading, ParsedDocument, ParsedNode, ParseError
from app.pipeline.parse.pdf import mupdf
from app.pipeline.parse.text import outline_levels, split_authors
from app.pipeline.parse.tree import build_tree
from app.services.media import IMAGE_TYPES


def _targets(toc: list[TocEntry], spine: set[str]) -> Targets:
    """ToC entries that point into the reading order, as headings per document."""
    levels = outline_levels([(e.depth, e.title) for e in toc])
    targets: Targets = {}
    seen: set[tuple[str, str | None, str]] = set()
    for entry, level in zip(toc, levels, strict=True):
        key = (entry.path, entry.fragment, entry.title)
        if entry.path not in spine or key in seen:
            continue
        seen.add(key)
        targets.setdefault(entry.path, []).append((entry.fragment, Heading(level, entry.title)))
    return targets


def _documents(package: Package, warnings: list[str]) -> dict[str, Element]:
    documents: dict[str, Element] = {}
    for path in [*package.spine, *package.auxiliary]:
        try:
            documents[path] = parse_html(package.read(path))
        except (ParseError, ValueError) as exc:  # lxml raises ValueError / ParserError
            warnings.append(f"skipped {path}: {exc}")
    return documents


def _write_images(
    package: Package,
    images: dict[int, ImageSource],
    roots: list[ParsedNode],
    media_dir: Path,
    slug: str,
) -> list[str]:
    """Save each figure's image under its anchor; returns warnings for unreadable ones."""
    warnings: list[str] = []
    for root in roots:
        for node in root.walk():
            source = images.get(id(node))
            if source is None:
                continue
            suffix = Path(source.path or "").suffix.lower()
            web = suffix in IMAGE_TYPES
            relative = Path(slug) / f"{node.anchor}{suffix if web else '.png'}"
            target = media_dir / relative
            try:
                data = source.svg if source.svg is not None else package.read(source.path or "")
                if web:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(data)
                else:
                    mupdf.image_to_png(data, target, svg=source.svg is not None or suffix == ".svg")
            except (ParseError, RuntimeError, ValueError) as exc:
                warnings.append(f"figure {node.anchor}: image not readable ({exc})")
                continue
            node.meta["image_path"] = relative.as_posix()
    return warnings


def parse_epub(path: Path, *, slug: str, media_dir: Path) -> ParsedDocument:
    """Parse an EPUB 2 or 3 book; figures go to `media_dir/<slug>/<anchor>.<ext>`."""
    package = open_package(path)
    with package.archive:
        parsed = ParsedDocument(
            title=package.title,
            authors=[name for c in package.creators for name in split_authors(c)],
            year=package.year,
            language=package.language,
        )
        documents = _documents(package, parsed.warnings)
        targets = _targets(package.toc, set(package.spine))
        walker = Walker(Notes(documents), targets, cover=package.cover)
        for doc_path in package.spine:
            if doc_path in documents:
                walker.document(doc_path, documents[doc_path])
        events = walker.finish()
        parsed.warnings.extend(f"table of contents entry not found: {t}" for t in walker.unplaced)

        parsed.tier = 1 if targets else 2
        parsed.needs_review = not targets
        parsed.page_count = walker.max_page
        parsed.children = build_tree(events)
        if not any(not n.kind.is_container for n in parsed.walk()):
            raise ParseError(f"no text could be extracted from {path.name}")
        assign_anchors(parsed.children)
        parsed.warnings.extend(
            _write_images(package, walker.images, parsed.children, media_dir, slug)
        )
    return parsed

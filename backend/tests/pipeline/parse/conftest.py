"""Shared fixtures for the parsing tests: generated PDFs and tree lookups."""

from pathlib import Path

import pytest

from app.models.enums import NodeKind
from app.pipeline.parse import ParsedDocument, ParsedNode
from app.pipeline.parse.pdf import parse_pdf
from tests.pipeline.parse.builders import book_pdf


def of_kind(parsed: ParsedDocument, kind: NodeKind) -> list[ParsedNode]:
    return [n for n in parsed.walk() if n.kind is kind]


def outline(parsed: ParsedDocument) -> list[tuple[str, str | None]]:
    """`(anchor, heading)` of every container, in document order."""
    return [(n.anchor, n.heading) for n in parsed.walk() if n.kind.is_container]


@pytest.fixture(scope="module")
def book_path(tmp_path_factory: pytest.TempPathFactory) -> Path:
    return book_pdf(tmp_path_factory.mktemp("pdf") / "book.pdf")


@pytest.fixture(scope="module")
def media_dir(tmp_path_factory: pytest.TempPathFactory) -> Path:
    return tmp_path_factory.mktemp("media")


@pytest.fixture(scope="module")
def book(book_path: Path, media_dir: Path) -> ParsedDocument:
    """The tier-1 book, parsed once per module: tests only read it."""
    return parse_pdf(book_path, slug="meadows", media_dir=media_dir)

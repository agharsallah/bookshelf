"""Book covers: the EPUB's cover image or the PDF's first page, cached in the media folder."""

import os
import struct
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.models.enums import DocumentKind, Genre
from app.services.covers import COVER_WIDTH
from app.services.library import display_path
from tests.api.factories import make_document
from tests.pipeline.parse.builders import book_pdf
from tests.pipeline.parse.epub_builders import book_epub, opf, page, png, untitled_book, write_epub

URL = "/api/v1/documents"


def png_width(data: bytes) -> int:
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    return struct.unpack(">I", data[16:20])[0]


def cover_sized(data: bytes) -> bool:
    """Rendered at about COVER_WIDTH pixels wide (the dpi is a whole number)."""
    return abs(png_width(data) - COVER_WIDTH) <= COVER_WIDTH * 0.02


def shelve(session: Session, library_dir: Path, file: Path, kind: DocumentKind, **overrides):
    return make_document(
        session, kind=kind, source_path=display_path(library_dir, file), **overrides
    )


def test_an_epub_book_shows_its_own_cover_image(
    client: TestClient, session: Session, library_dir: Path, media_dir: Path
):
    book = shelve(session, library_dir, book_epub(library_dir / "book.epub"), DocumentKind.EPUB)

    response = client.get(f"{URL}/{book.slug}/cover")

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert response.content == png()
    assert "max-age=86400" in response.headers["cache-control"]
    assert response.headers["cross-origin-resource-policy"] == "cross-origin"
    assert (media_dir / book.slug / "cover.png").read_bytes() == png()


def test_an_epub_2_cover_named_by_its_path_is_found_too(
    client: TestClient, session: Session, library_dir: Path
):
    """Some tools write `<meta name="cover" content="Images/cover.png"/>`, unlisted."""
    manifest = '<item id="one" href="one.xhtml" media-type="application/xhtml+xml"/>'
    metadata = '<dc:title>Tools</dc:title><meta name="cover" content="Images/cover.png"/>'
    file = write_epub(
        library_dir / "tools.epub",
        {
            "OEBPS/content.opf": opf(metadata, manifest, '<itemref idref="one"/>'),
            "OEBPS/one.xhtml": page("<h1>One</h1><p>Words.</p>"),
            "OEBPS/Images/cover.png": png(),
        },
    )
    book = shelve(session, library_dir, file, DocumentKind.EPUB)

    assert client.get(f"{URL}/{book.slug}/cover").content == png()


def test_a_pdf_book_shows_its_first_page_rendered(
    client: TestClient, session: Session, library_dir: Path
):
    book = shelve(session, library_dir, book_pdf(library_dir / "book.pdf"), DocumentKind.PDF)

    response = client.get(f"{URL}/{book.id}/cover")

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert cover_sized(response.content)


def test_the_cover_is_made_once_and_remade_when_the_book_changes(
    client: TestClient, session: Session, library_dir: Path, media_dir: Path
):
    source = book_pdf(library_dir / "book.pdf")
    book = shelve(session, library_dir, source, DocumentKind.PDF)
    client.get(f"{URL}/{book.slug}/cover")
    cached = media_dir / book.slug / "cover.png"
    cached.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\0" * 24)  # marks the cached copy

    assert client.get(f"{URL}/{book.slug}/cover").content == cached.read_bytes()

    later = cached.stat().st_mtime + 10
    os.utime(source, (later, later))
    assert cover_sized(client.get(f"{URL}/{book.slug}/cover").content)


@pytest.mark.parametrize("genre", [Genre.PAPER, Genre.ARTICLE])
def test_papers_and_articles_have_no_cover(
    client: TestClient, session: Session, library_dir: Path, genre: Genre
):
    doc = shelve(
        session, library_dir, book_pdf(library_dir / "p.pdf"), DocumentKind.PDF, genre=genre
    )

    assert client.get(f"{URL}/{doc.slug}/cover").status_code == 404


def test_a_book_without_a_cover_or_its_file_is_404(
    client: TestClient, session: Session, library_dir: Path, media_dir: Path
):
    bare = shelve(session, library_dir, untitled_book(library_dir / "bare.epub"), DocumentKind.EPUB)
    gone = make_document(session, kind=DocumentKind.PDF, source_path="library/missing.pdf")
    outside = make_document(session, kind=DocumentKind.PDF, source_path="../../etc/passwd")

    for doc in (bare, gone, outside):
        assert client.get(f"{URL}/{doc.slug}/cover").status_code == 404
    assert not (media_dir / bare.slug / "cover.png").exists()

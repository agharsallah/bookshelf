"""Genre on documents (docs/PAPERS.md P1): set at ingest, filtered in the listing, edited
by PATCH; a human choice is marked so detection after parsing leaves it alone."""

from collections.abc import Callable
from pathlib import Path

import httpx
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.models import Document
from app.models.enums import Genre
from app.services.documents import GENRE_SOURCE
from tests.api.factories import make_document, write_file
from tests.conftest import AUTH

URL = "/api/v1/documents"
Web = Callable[[Callable[[httpx.Request], httpx.Response]], None]


def test_ingest_stores_an_explicit_genre_as_a_human_choice(
    client: TestClient, session: Session, library_dir: Path
):
    write_file(library_dir, "attention.pdf", b"%PDF-1.7 paper")

    response = client.post(
        URL, json={"path": "library/attention.pdf", "genre": "paper"}, headers=AUTH
    )

    assert response.status_code == 202
    document = response.json()["document"]
    assert document["genre"] == "paper"
    stored = session.get(Document, document["id"])
    assert stored is not None
    assert stored.meta[GENRE_SOURCE] == "human"


def test_a_file_without_a_genre_is_a_book_until_detection(
    client: TestClient, session: Session, library_dir: Path
):
    write_file(library_dir, "meadows.pdf", b"%PDF-1.7 book")

    document = client.post(URL, json={"path": "library/meadows.pdf"}, headers=AUTH).json()[
        "document"
    ]

    assert document["genre"] == "book"
    stored = session.get(Document, document["id"])
    assert stored is not None
    assert GENRE_SOURCE not in stored.meta


def test_a_url_is_an_article_unless_told_otherwise(client: TestClient, web: Web):
    page = b"<html><head><title>A preprint</title></head><body><p>Text.</p></body></html>"
    web(lambda request: httpx.Response(200, content=page, headers={"content-type": "text/html"}))

    plain = client.post(URL, json={"url": "https://example.com/a"}, headers=AUTH).json()
    assert plain["document"]["genre"] == "article"


def test_an_unknown_genre_is_422(client: TestClient, library_dir: Path):
    write_file(library_dir, "x.pdf", b"%PDF-1.7 x")

    response = client.post(URL, json={"path": "library/x.pdf", "genre": "novel"}, headers=AUTH)

    assert response.status_code == 422


def test_the_listing_filters_by_genre(client: TestClient, session: Session):
    paper = make_document(session, genre=Genre.PAPER)
    make_document(session)  # a book

    papers = client.get(URL, params={"genre": "paper"}).json()
    everything = client.get(URL).json()

    assert [item["id"] for item in papers["items"]] == [str(paper.id)]
    assert papers["total"] == 1
    assert everything["total"] == 2


def test_patch_changes_the_genre_and_marks_it_human(client: TestClient, session: Session):
    document = make_document(session, meta={"final_url": "https://example.com"})

    response = client.patch(f"{URL}/{document.slug}", json={"genre": "paper"}, headers=AUTH)

    assert response.status_code == 200
    assert response.json()["genre"] == "paper"
    session.refresh(document)
    assert document.genre is Genre.PAPER
    assert document.meta == {"final_url": "https://example.com", GENRE_SOURCE: "human"}


def test_patch_refuses_a_null_genre(client: TestClient, session: Session):
    document = make_document(session)

    response = client.patch(f"{URL}/{document.slug}", json={"genre": None}, headers=AUTH)

    assert response.status_code == 422

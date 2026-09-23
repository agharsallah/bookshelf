"""Every write endpoint of this API requires the key; reads stay open."""

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from tests.api.factories import make_book, make_note

WRITES = [
    ("post", "/api/v1/documents"),
    ("patch", "/api/v1/documents/{slug}"),
    ("delete", "/api/v1/documents/{slug}"),
    ("patch", "/api/v1/documents/{slug}/outline"),
    ("post", "/api/v1/notes"),
    ("patch", "/api/v1/notes/{note}"),
    ("delete", "/api/v1/notes/{note}"),
]


@pytest.mark.parametrize(("method", "path"), WRITES)
def test_writes_without_the_api_key_are_401_and_change_nothing(
    client: TestClient, session: Session, method: str, path: str
):
    book = make_book(session)
    note = make_note(session, book, "ch01/s01/p001")
    url = path.format(slug=book.slug, note=note.id)

    response = client.request(method, url, json={})

    assert response.status_code == 401
    assert client.get(f"/api/v1/documents/{book.slug}").status_code == 200
    assert client.get(f"/api/v1/notes/{note.id}").status_code == 200

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


# Mutating verbs that stay open on purpose: `POST /search` is a read-only query sent as
# POST for its body; it never writes and never runs a model. Nor does the build context
# preview (`POST …/builds/context/render`): it renders the form's options, saves nothing.
OPEN_WRITES = {
    ("post", "/api/v1/search"),
    ("post", "/api/v1/papers/{ref}/builds/context/render"),
}
MUTATING = {"post", "put", "patch", "delete"}


def _mutating_operations() -> list[tuple[str, str]]:
    from app.main import create_app

    paths = create_app().openapi()["paths"]
    return sorted(
        (method, path)
        for path, operations in paths.items()
        for method in operations
        if method in MUTATING and (method, path) not in OPEN_WRITES
    )


def test_every_mutating_route_is_enumerated():
    operations = _mutating_operations()

    assert len(operations) >= 20  # the walk found the API, not an empty schema
    assert ("post", "/api/v1/search/answer") in operations  # spends model runs


@pytest.mark.parametrize(("method", "path"), _mutating_operations())
def test_every_mutating_route_requires_the_api_key(client: TestClient, method: str, path: str):
    """A new write route without `require_api_key` fails here, whatever its body shape:
    the key is checked before path, query and body validation."""
    placeholder = "00000000-0000-0000-0000-000000000000"
    url = path
    for name in ("ref", "document_ref", "artifact_id", "concept_id", "edge_id", "job_id",
                 "note_id", "name", "anchor", "recall_id", "item_id", "index",
                 "candidate_id", "pass", "set_id", "version", "document_id",
                 "build_id"):  # fmt: skip
        url = url.replace(f"{{{name}}}", placeholder)

    response = client.request(method, url, json={})

    assert "{" not in url, f"unhandled path parameter in {path}"
    assert response.status_code == 401, f"{method.upper()} {path} is not guarded"

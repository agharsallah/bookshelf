"""Happy-path and edge-case coverage for the books resource."""

from fastapi.testclient import TestClient

from tests.conftest import AUTH


def _create(client: TestClient, **overrides: object) -> dict[str, object]:
    payload = {"title": "A Book", "author": "An Author"} | overrides
    response = client.post("/api/v1/books", json=payload, headers=AUTH)
    assert response.status_code == 201, response.text
    return response.json()


def test_create_returns_201_and_defaults(client: TestClient, book_payload: dict[str, object]):
    response = client.post("/api/v1/books", json=book_payload, headers=AUTH)

    assert response.status_code == 201
    body = response.json()
    assert body["id"] >= 1
    assert body["title"] == "Thinking in Systems"
    assert body["status"] == "reading"
    assert body["rating"] is None
    assert body["tags"] == ["systems"]


def test_get_roundtrips(client: TestClient):
    created = _create(client, title="Deep Work")

    response = client.get(f"/api/v1/books/{created['id']}")

    assert response.status_code == 200
    assert response.json()["title"] == "Deep Work"


def test_get_missing_returns_error_envelope(client: TestClient):
    response = client.get("/api/v1/books/9999")

    assert response.status_code == 404
    error = response.json()["error"]
    assert error["code"] == "not_found"
    assert error["request_id"]


def test_list_paginates_and_reports_total(client: TestClient):
    for index in range(5):
        _create(client, title=f"Book {index}")

    response = client.get("/api/v1/books", params={"limit": 2, "offset": 0})

    body = response.json()
    assert response.status_code == 200
    assert body["total"] == 5
    assert len(body["items"]) == 2
    assert body["limit"] == 2


def test_list_filters_by_status_and_search(client: TestClient):
    _create(client, title="Systems Thinking", status="finished")
    _create(client, title="Other", author="Someone", status="reading")

    by_status = client.get("/api/v1/books", params={"status": "finished"}).json()
    by_search = client.get("/api/v1/books", params={"search": "systems"}).json()

    assert by_status["total"] == 1
    assert by_status["items"][0]["title"] == "Systems Thinking"
    assert by_search["total"] == 1


def test_patch_is_partial(client: TestClient):
    created = _create(client, title="Draft", author="Author")

    response = client.patch(
        f"/api/v1/books/{created['id']}",
        json={"rating": 5, "status": "finished"},
        headers=AUTH,
    )

    body = response.json()
    assert response.status_code == 200
    assert body["rating"] == 5
    assert body["status"] == "finished"
    assert body["author"] == "Author"  # untouched


def test_delete_then_get_is_404(client: TestClient):
    created = _create(client)

    assert client.delete(f"/api/v1/books/{created['id']}", headers=AUTH).status_code == 204
    assert client.get(f"/api/v1/books/{created['id']}").status_code == 404


def test_finished_before_started_is_rejected(client: TestClient):
    response = client.post(
        "/api/v1/books",
        json={
            "title": "Time Travel",
            "author": "Nobody",
            "started_on": "2026-05-01",
            "finished_on": "2026-04-01",
        },
        headers=AUTH,
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"

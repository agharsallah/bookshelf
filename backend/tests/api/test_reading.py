"""Reading progress: validation, upsert semantics, and most-recent-first ordering."""

from fastapi.testclient import TestClient
from sqlmodel import Session

from tests.api.factories import make_book
from tests.conftest import AUTH


def url(ref: object) -> str:
    return f"/api/v1/documents/{ref}/reading"


def save(client: TestClient, ref: object, unit: str, anchor: str, progress: float):
    body = {"unit": unit, "anchor": anchor, "progress": progress}
    return client.put(url(ref), json=body, headers=AUTH)


def test_a_new_document_has_no_positions(client: TestClient, session: Session):
    book = make_book(session)

    response = client.get(url(book.slug))

    assert response.status_code == 200
    assert response.json() == []


def test_saving_stores_the_position(client: TestClient, session: Session):
    book = make_book(session)

    response = save(client, book.id, "ch01", "ch01/s01/p002", 0.4)

    assert response.status_code == 200
    body = response.json()
    assert (body["unit"], body["anchor"], body["progress"]) == ("ch01", "ch01/s01/p002", 0.4)
    assert [p["anchor"] for p in client.get(url(book.slug)).json()] == ["ch01/s01/p002"]


def test_the_place_moves_back_but_progress_never_does(client: TestClient, session: Session):
    book = make_book(session)
    save(client, book.slug, "ch01", "ch01/s02/t001", 0.9)

    body = save(client, book.slug, "ch01", "ch01/s01/p001", 0.2).json()

    assert (body["anchor"], body["progress"]) == ("ch01/s01/p001", 0.9)


def test_positions_come_most_recently_read_first(client: TestClient, session: Session):
    book = make_book(session)
    save(client, book.slug, "ch01", "ch01/s01/p001", 0.1)
    save(client, book.slug, "ch02", "ch02/p001", 0.5)
    save(client, book.slug, "ch01", "ch01/s01/p002", 0.3)

    units = [p["unit"] for p in client.get(url(book.slug)).json()]

    assert units == ["ch01", "ch02"]


def test_the_anchor_must_lie_inside_the_unit(client: TestClient, session: Session):
    book = make_book(session)

    response = save(client, book.slug, "ch01", "ch02/p001", 0.5)

    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["field"] == "body.anchor"
    assert client.get(url(book.slug)).json() == []


def test_the_unit_must_be_a_chapter_of_the_document(client: TestClient, session: Session):
    book = make_book(session)

    missing = save(client, book.slug, "ch09", "ch09/p001", 0.5)
    leaf = save(client, book.slug, "ch02/p001", "ch02/p001", 0.5)

    assert [r.json()["error"]["details"][0]["field"] for r in (missing, leaf)] == ["body.unit"] * 2


def test_the_anchor_must_exist(client: TestClient, session: Session):
    book = make_book(session)

    response = save(client, book.slug, "ch01", "ch01/s01/p099", 0.5)

    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["field"] == "body.anchor"


def test_progress_must_be_a_fraction(client: TestClient, session: Session):
    book = make_book(session)

    assert save(client, book.slug, "ch01", "ch01/s01/p001", 1.5).status_code == 422


def test_saving_needs_the_api_key(client: TestClient, session: Session):
    book = make_book(session)

    response = client.put(url(book.slug), json={"unit": "ch01", "anchor": "ch01", "progress": 0})

    assert response.status_code == 401


def test_an_unknown_document_is_404(client: TestClient):
    assert client.get(url("nope")).status_code == 404

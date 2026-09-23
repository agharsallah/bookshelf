"""Plain highlights: a note without words costs no model call, and may gain its words
exactly once (D11: after that `raw` never changes)."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlmodel import Session, select

from app.models import Job
from app.models.enums import JobKind
from tests.api.factories import make_book, make_note
from tests.conftest import AUTH

URL = "/api/v1/notes"
ANCHOR = "ch01/s01/p001"


def jobs(session: Session) -> list[Job]:
    return list(session.exec(select(Job)))


def test_a_highlight_without_words_queues_no_job(client: TestClient, session: Session):
    book = make_book(session)
    body = {"document_id": str(book.id), "anchor": ANCHOR, "range": {"start": 0, "end": 4}}

    response = client.post(URL, json=body, headers=AUTH)

    assert response.status_code == 201
    assert (response.json()["raw"], response.json()["job"]) == (None, None)
    assert jobs(session) == []


def test_adding_words_to_a_highlight_once_queues_structuring(client: TestClient, session):
    note = make_note(session, make_book(session), ANCHOR, raw=None)

    first = client.patch(f"{URL}/{note.id}", json={"raw": "Delays!"}, headers=AUTH)
    second = client.patch(f"{URL}/{note.id}", json={"raw": "Second thoughts"}, headers=AUTH)

    assert first.status_code == 200 and first.json()["raw"] == "Delays!"
    assert second.status_code == 409
    [job] = jobs(session)
    assert (job.kind, job.payload) == (JobKind.STRUCTURE_NOTE, {"note_id": str(note.id)})


def test_a_patch_must_change_something_and_cannot_remove_words(client: TestClient, session):
    note = make_note(session, make_book(session), ANCHOR)

    empty = client.patch(f"{URL}/{note.id}", json={}, headers=AUTH)
    removal = client.patch(f"{URL}/{note.id}", json={"raw": None}, headers=AUTH)

    assert (empty.status_code, removal.status_code) == (422, 422)


def test_the_database_allows_words_once_and_never_takes_them_back(session: Session):
    note = make_note(session, make_book(session), ANCHOR, raw=None)
    params = {"id": note.id}

    session.execute(text("update notes set raw = 'first words' where id = :id"), params)
    session.commit()
    with pytest.raises(DBAPIError, match="immutable"):
        session.execute(text("update notes set raw = null where id = :id"), params)
    session.rollback()


def test_a_highlight_cannot_be_structured_by_hand(client: TestClient, session: Session):
    book = make_book(session)
    note = make_note(session, book, ANCHOR, raw=None)
    body = {"kind": "structure_note", "document_id": str(book.id), "note_id": str(note.id)}

    response = client.post("/api/v1/jobs", json=body, headers=AUTH)

    assert response.status_code == 422
    assert jobs(session) == []

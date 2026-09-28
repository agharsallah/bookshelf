"""Recalls and predictions over the API: kept verbatim, never edited; a recall queues its grade."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlmodel import Session, select

from app.models import Job, Recall
from app.models.enums import JobKind
from tests.api.factories import make_book
from tests.conftest import AUTH


def post(client: TestClient, slug: str, **body) -> dict:
    response = client.post(f"/api/v1/documents/{slug}/recalls", json=body, headers=AUTH)
    return {"status": response.status_code, **response.json()}


def test_a_recall_is_kept_and_queues_its_grade(client: TestClient, session: Session, book):
    created = post(client, book.slug, unit="ch01", raw="  The text of the first part.  ")

    assert created["status"] == 201
    assert created["raw"] == "The text of the first part."
    job = session.exec(select(Job)).one()
    assert job.kind is JobKind.GRADE_RECALL
    assert job.payload == {"recall_id": created["id"]}
    assert created["job"]["id"] == str(job.id)


def test_a_prediction_is_kept_without_a_job(client: TestClient, session: Session, book):
    created = post(client, book.slug, unit="ch02", kind="prediction", raw="It argues for tubs.")

    assert created["status"] == 201
    assert created["job"] is None
    assert session.exec(select(Job)).all() == []
    listed = client.get(f"/api/v1/documents/{book.slug}/recalls?unit=ch02").json()
    assert [(r["kind"], r["raw"], r["grade"]) for r in listed] == [
        ("prediction", "It argues for tubs.", None)
    ]


def test_a_recall_needs_something_to_grade_against(client: TestClient, session: Session):
    bare = make_book(session)
    refused = post(client, bare.slug, unit="ch01", raw="Something.")

    assert refused["status"] == 422
    assert session.exec(select(Recall)).all() == []


def test_the_unit_must_be_a_chapter(client: TestClient, book):
    assert post(client, book.slug, unit="ch01/s01/p001", raw="x")["status"] == 422
    assert post(client, book.slug, unit="ch09", raw="x")["status"] == 422


def test_your_words_are_never_edited(client: TestClient, session: Session, book):
    created = post(client, book.slug, unit="ch01", raw="Mine.")
    with pytest.raises(DBAPIError, match="immutable"):
        session.execute(
            text("update recalls set raw = 'Theirs.' where id = :id"), {"id": created["id"]}
        )
    session.rollback()


def test_grading_again_reuses_the_waiting_job(client: TestClient, session: Session, book):
    created = post(client, book.slug, unit="ch01", raw="Mine.")
    again = client.post(
        f"/api/v1/documents/{book.slug}/recalls/{created['id']}/grade", headers=AUTH
    )

    assert again.status_code == 202
    assert again.json()["id"] == created["job"]["id"]

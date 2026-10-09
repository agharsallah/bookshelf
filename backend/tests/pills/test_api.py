"""`POST /pills/rebuild` and `GET /pills/{id}`."""

import uuid
from datetime import UTC, datetime

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.models import Document, Job
from app.models.enums import ArtifactType, JobKind
from app.models.pill import Pill
from app.pills.contract import PILL_SCHEMA_ID
from app.pills.store import sync_document
from app.pipeline.gates import schema_errors
from tests.api.factories import make_artifact
from tests.conftest import AUTH
from tests.pills.conftest import make_shelf_book
from tests.pills.fixtures import example

URL = "/api/v1/pills"


def test_rebuild_one_document_queues_its_harvest_once(
    client: TestClient, session: Session, book: Document
):
    first = client.post(f"{URL}/rebuild", json={"document": book.slug}, headers=AUTH)
    again = client.post(f"{URL}/rebuild", json={"document": str(book.id)}, headers=AUTH)

    assert first.status_code == 202
    (job,) = session.exec(select(Job).where(Job.kind == JobKind.HARVEST_PILLS)).all()
    assert first.json() == again.json() == {"jobs": [str(job.id)]}
    assert job.document_id == book.id


def test_rebuild_everything_skips_archived_documents(
    client: TestClient, session: Session, book: Document
):
    make_shelf_book(session, archived_at=datetime.now(UTC))

    response = client.post(f"{URL}/rebuild", json={}, headers=AUTH)

    jobs = session.exec(select(Job).where(Job.kind == JobKind.HARVEST_PILLS)).all()
    assert response.json() == {"jobs": [str(j.id) for j in jobs]}
    assert [j.document_id for j in jobs] == [book.id]


def test_rebuild_needs_the_key_and_a_known_document(client: TestClient, book: Document):
    assert client.post(f"{URL}/rebuild", json={}).status_code == 401
    missing = client.post(f"{URL}/rebuild", json={"document": "nope"}, headers=AUTH)
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "not_found"


def test_a_pill_on_the_wire_is_self_contained(client: TestClient, session: Session, book: Document):
    make_artifact(
        session,
        book,
        type=ArtifactType.CATALOGUE_ENTRY,
        skill="catalogue-document",
        body={"theme": {"name": "Operations"}},
    )
    make_artifact(session, book, type=ArtifactType.QUIZ, anchor="ch03", body=example("make-quiz"))
    sync_document(session, book)
    pill = session.exec(select(Pill)).first()
    assert pill is not None

    response = client.get(f"{URL}/{pill.id}")

    assert response.status_code == 200
    wire = response.json()
    assert schema_errors({"$ref": PILL_SCHEMA_ID}, wire) == []
    assert wire["document"] == {
        "id": str(book.id),
        "slug": book.slug,
        "title": "Queueing for Managers",
        "genre": "book",
        "theme": "Operations",
    }
    assert wire["unit_title"] == "Heading ch03"
    assert set(wire["sources"]) == set(wire["cites"])
    assert wire["sources"][wire["cites"][0]] == {
        "document": {"id": str(book.id), "slug": book.slug, "title": book.title},
        "anchor": wire["cites"][0],
    }
    assert wire["thread"] is None and wire["review_item_id"] is None


def test_threads_and_cross_document_cites_resolve(
    client: TestClient, session: Session, book: Document
):
    other = make_shelf_book(session, slug="meadows-systems", title="Thinking in Systems")
    spans = [
        {
            "text": "Waiting explodes once a team is loaded past eighty percent.",
            "cites": ["ch03/p001"],
        }
    ]
    rows = [
        Pill(
            document_id=book.id,
            anchor="ch03",
            kind="insight",
            body={"spans": spans},
            cites=["ch03/p001", "meadows-systems:ch01/p001", "gone-book:ch01/p001"],
            thread_key="t1",
            thread_index=i,
            thread_title="Why busy teams are slow",
            est_seconds=8,
            origin="skill:make-pills@1",
            source_key=f"k{i}",
        )
        for i in range(3)
    ]
    session.add_all(rows)
    session.commit()

    wire = client.get(f"{URL}/{rows[1].id}").json()

    assert wire["thread"] == {
        "key": "t1",
        "index": 1,
        "size": 3,
        "title": "Why busy teams are slow",
    }
    assert wire["sources"]["meadows-systems:ch01/p001"]["document"]["id"] == str(other.id)
    assert "gone-book:ch01/p001" not in wire["sources"]


def test_an_unknown_pill_is_404(client: TestClient):
    response = client.get(f"{URL}/{uuid.uuid4()}")

    assert response.status_code == 404

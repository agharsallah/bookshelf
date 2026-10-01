"""Archive and restore (a document put away with nothing lost), and deleting one for good."""

from datetime import timedelta
from pathlib import Path

from fastapi.testclient import TestClient
from sqlmodel import Session, col, select

from app.jobs import queue
from app.jobs.queue import JobSpec
from app.models import Document, Job, Note
from app.models._columns import utcnow
from app.models.enums import JobKind, JobState, ReviewSource
from app.services import reviews
from app.services.archive import HELD
from app.services.documents import PURGE
from tests.api.factories import make_book, make_document, make_note, write_file
from tests.conftest import AUTH

URL = "/api/v1/documents"


def slugs(client: TestClient, **params: str) -> list[str]:
    return [d["slug"] for d in client.get(URL, params=params).json()["items"]]


def archive(client: TestClient, document: Document) -> dict:
    response = client.post(f"{URL}/{document.slug}/archive", headers=AUTH)
    assert response.status_code == 200
    return response.json()


def restore(client: TestClient, document: Document) -> dict:
    response = client.post(f"{URL}/{document.slug}/restore", headers=AUTH)
    assert response.status_code == 200
    return response.json()


def test_an_archived_document_leaves_the_shelf_and_keeps_everything(
    client: TestClient, session: Session
):
    book = make_book(session, slug="put-away")
    make_note(session, book, "ch01/s01/p001")
    make_document(session, slug="kept")

    body = archive(client, book)

    assert body["archived_at"] is not None
    assert slugs(client) == ["kept"]
    assert slugs(client, archived="true") == ["put-away"]
    detail = client.get(f"{URL}/put-away").json()
    assert detail["archived_at"] is not None
    assert detail["counts"]["notes"] == 1
    assert detail["counts"]["chapters"] == 2


def test_restore_puts_it_back_on_the_shelf(client: TestClient, session: Session):
    book = make_document(session, slug="back-again")
    archive(client, book)

    body = restore(client, book)

    assert body["document"]["archived_at"] is None
    assert slugs(client) == ["back-again"]
    assert slugs(client, archived="true") == []


def test_archiving_holds_queued_work_and_purges_search(client: TestClient, session: Session):
    book = make_document(session)
    held = queue.enqueue(session, JobSpec(kind=JobKind.PARSE, document_id=book.id))
    assert held is not None

    archive(client, book)

    session.refresh(held)
    assert (held.state, held.error) == (JobState.SKIPPED, HELD)
    purge = session.exec(select(Job).where(col(Job.document_id).is_(None))).one()
    assert (purge.kind, purge.payload) == (JobKind.EMBED, {PURGE: str(book.id)})


def test_the_worker_claims_nothing_for_an_archived_document(client: TestClient, session: Session):
    book = make_document(session)
    archive(client, book)
    session.commit()  # a new transaction: its now() must come after the purge was queued
    purge = queue.claim(session)  # the purge job has no document, so it runs
    assert purge is not None and purge.document_id is None
    queue.enqueue(session, JobSpec(kind=JobKind.PARSE, document_id=book.id))  # arrives later

    assert queue.claim(session) is None

    restore(client, book)
    claimed = queue.claim(session)
    assert claimed is not None and claimed.document_id == book.id


def test_restore_requeues_held_work_once(client: TestClient, session: Session):
    book = make_document(session)
    queue.enqueue(session, JobSpec(kind=JobKind.BRIEF, document_id=book.id))
    archive(client, book)

    first = restore(client, book)
    archive(client, book)
    second = restore(client, book)

    assert [j["kind"] for j in first["requeued"]] == ["brief"]
    assert [j["kind"] for j in second["requeued"]] == ["brief"]  # held again by the 2nd archive
    queued = session.exec(
        select(Job).where(Job.document_id == book.id, Job.state == JobState.QUEUED)
    ).all()
    assert [j.kind for j in queued] == [JobKind.BRIEF]


def test_restore_reindexes_a_document_that_had_been_indexed(client: TestClient, session: Session):
    indexed, never = make_document(session), make_document(session)
    embed = queue.enqueue(session, JobSpec(kind=JobKind.EMBED, document_id=indexed.id))
    assert embed is not None
    queue.complete(session, embed)
    for document in (indexed, never):
        archive(client, document)

    assert [j["kind"] for j in restore(client, indexed)["requeued"]] == ["embed"]
    assert restore(client, never)["requeued"] == []


def test_archive_and_restore_are_safe_to_repeat(client: TestClient, session: Session):
    book = make_document(session)

    first = archive(client, book)["archived_at"]
    again = archive(client, book)["archived_at"]

    assert first == again
    restore(client, book)
    assert restore(client, book)["requeued"] == []


def test_an_archived_books_cards_are_not_due(client: TestClient, session: Session):
    away, here = make_book(session), make_book(session)
    for book in (away, here):
        draft = reviews.ItemDraft(
            document_id=book.id,
            anchor="ch01/s01/p001",
            source=ReviewSource.RECALL,
            source_key=str(book.id),
            prompt="What is slack for?",
            answer=[{"text": "Reserve.", "cites": ["ch01/s01/p001"]}],
        )
        reviews.add_item(session, draft, due=utcnow() - timedelta(days=1))
    session.commit()

    archive(client, away)
    body = client.get("/api/v1/reviews/due").json()

    assert body["total"] == 1
    assert [c["document"]["slug"] for c in body["items"]] == [here.slug]


def test_archive_and_restore_need_the_api_key(client: TestClient, session: Session):
    book = make_document(session)

    assert client.post(f"{URL}/{book.slug}/archive").status_code == 401
    assert client.post(f"{URL}/{book.slug}/restore").status_code == 401


def test_delete_with_file_removes_the_original_too(
    client: TestClient, session: Session, library_dir: Path
):
    write_file(library_dir, "gone.pdf")
    created = client.post(URL, json={"path": "library/gone.pdf"}, headers=AUTH).json()

    response = client.delete(
        f"{URL}/{created['document']['slug']}", params={"file": "true"}, headers=AUTH
    )

    assert response.status_code == 204
    assert not (library_dir / "gone.pdf").exists()
    assert session.exec(select(Document)).all() == []


def test_delete_never_removes_a_file_outside_the_library(client: TestClient, session: Session):
    book = make_document(session, source_path="backend/pyproject.toml")
    make_note(session, book, "ch01")

    response = client.delete(f"{URL}/{book.slug}", params={"file": "true"}, headers=AUTH)

    assert response.status_code == 422
    assert session.get(Document, book.id) is not None  # nothing was deleted
    assert len(session.exec(select(Note)).all()) == 1


def test_delete_removes_the_documents_media(client: TestClient, session: Session, media_dir: Path):
    book = make_document(session)
    crop = write_file(media_dir / book.slug / "ch01", "f001.png")
    other = write_file(media_dir / "someone-else", "f001.png")

    client.delete(f"{URL}/{book.slug}", headers=AUTH)

    assert not crop.exists()
    assert other.exists()


def test_an_archived_document_can_be_deleted(client: TestClient, session: Session):
    book = make_document(session)
    archive(client, book)

    assert client.delete(f"{URL}/{book.slug}", headers=AUTH).status_code == 204
    assert slugs(client, archived="true") == []

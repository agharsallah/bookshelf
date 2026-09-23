"""Notes: anchor and range validation, structure_note jobs, detached notes, D11."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlmodel import Session, select

from app.models import Artifact, Job, Node, Note
from app.models.enums import ArtifactType, JobKind, Review
from tests.api.factories import make_artifact, make_book, make_note
from tests.conftest import AUTH

URL = "/api/v1/notes"
ANCHOR = "ch01/s01/p001"  # text: "Text of ch01/s01/p001." (22 chars)


def create(client: TestClient, document_id: object, **body: object):
    payload = {"document_id": str(document_id), "anchor": ANCHOR, "raw": "Delays!", **body}
    return client.post(URL, json=payload, headers=AUTH)


def test_create_stores_the_note_and_queues_structure_note(client: TestClient, session: Session):
    book = make_book(session)

    response = create(client, book.id, range={"start": 0, "end": 22}, color="amber")

    assert response.status_code == 201
    body = response.json()
    assert (body["anchor"], body["raw"], body["color"]) == (ANCHOR, "Delays!", "amber")
    assert body["range"] == {"start": 0, "end": 22}
    job = session.exec(select(Job)).one()
    assert (job.kind, job.anchor, job.payload) == (
        JobKind.STRUCTURE_NOTE,
        ANCHOR,
        {"note_id": body["id"]},
    )
    assert body["job"]["id"] == str(job.id)


def test_two_notes_on_one_anchor_each_get_a_job(client: TestClient, session: Session):
    book = make_book(session)

    create(client, book.id, raw="first")
    create(client, book.id, raw="second")

    payloads = {j.payload["note_id"] for j in session.exec(select(Job)).all()}
    assert payloads == {str(n.id) for n in session.exec(select(Note)).all()}
    assert len(payloads) == 2


def test_anchor_must_exist_in_the_document(client: TestClient, session: Session):
    book = make_book(session)

    response = create(client, book.id, anchor="ch09/p001")

    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["field"] == "body.anchor"
    assert session.exec(select(Note)).all() == []
    assert session.exec(select(Job)).all() == []


@pytest.mark.parametrize(
    ("start", "end", "status"),
    [(0, 22, 201), (21, 22, 201), (0, 23, 422), (5, 5, 422), (6, 5, 422), (-1, 4, 422)],
)
def test_range_must_lie_within_the_node_text(
    client: TestClient, session: Session, start: int, end: int, status: int
):
    book = make_book(session)

    response = create(client, book.id, range={"start": start, "end": end})

    assert response.status_code == status


def test_unknown_document_is_404(client: TestClient):
    response = create(client, "00000000-0000-0000-0000-000000000000")

    assert response.status_code == 404


def test_list_attaches_the_newest_structured_version(client: TestClient, session: Session):
    book = make_book(session)
    note = make_note(session, book, ANCHOR)
    make_artifact(
        session, book, type=ArtifactType.STRUCTURED_NOTE, anchor=ANCHOR, note_id=note.id, version=1
    )
    newest = make_artifact(
        session,
        book,
        type=ArtifactType.STRUCTURED_NOTE,
        anchor=ANCHOR,
        note_id=note.id,
        version=2,
        review=Review.DRAFT,
        body={"blocks": [], "tags": ["delay"]},
    )
    bare = make_note(session, book, "ch02/p001")

    items = client.get(URL, params={"document_id": str(book.id)}).json()["items"]

    by_id = {i["id"]: i for i in items}
    structured = by_id[str(note.id)]["structured"]
    assert (structured["id"], structured["version"], structured["review"]) == (
        str(newest.id),
        2,
        "draft",
    )
    assert structured["body"]["tags"] == ["delay"]
    assert by_id[str(bare.id)]["structured"] is None


def test_notes_whose_anchor_vanished_are_detached_not_dropped(client: TestClient, session: Session):
    book = make_book(session)
    kept = make_note(session, book, ANCHOR)
    orphan = make_note(session, book, "ch01/s01/p002")
    node = session.exec(select(Node).where(Node.anchor == "ch01/s01/p002")).one()
    session.delete(node)  # a re-parse that no longer produces this anchor
    session.commit()

    items = client.get(URL, params={"document_id": str(book.id)}).json()["items"]

    assert {i["id"]: i["detached"] for i in items} == {str(kept.id): False, str(orphan.id): True}


def test_anchor_filter_includes_descendants_only(client: TestClient, session: Session):
    book = make_book(session)
    make_note(session, book, "ch01/s01/p001")
    make_note(session, book, "ch02/p001")

    items = client.get(URL, params={"document_id": str(book.id), "anchor": "ch01"}).json()["items"]

    assert [i["anchor"] for i in items] == ["ch01/s01/p001"]


def test_patch_changes_color_only(client: TestClient, session: Session):
    note = make_note(session, make_book(session), ANCHOR, color="amber")

    response = client.patch(f"{URL}/{note.id}", json={"color": "sage"}, headers=AUTH)

    assert response.status_code == 200
    assert (response.json()["color"], response.json()["raw"]) == ("sage", "my words")


def test_patch_rewriting_raw_is_409_with_a_clear_message(client: TestClient, session: Session):
    note = make_note(session, make_book(session), ANCHOR)

    response = client.patch(f"{URL}/{note.id}", json={"raw": "rewritten"}, headers=AUTH)

    assert response.status_code == 409
    assert "immutable" in response.json()["error"]["message"]
    session.refresh(note)
    assert note.raw == "my words"


def test_database_refuses_to_rewrite_raw(session: Session):
    note = make_note(session, make_book(session), ANCHOR)

    with pytest.raises(DBAPIError, match="immutable"):
        session.execute(text("update notes set raw = 'x' where id = :id"), {"id": note.id})
    session.rollback()


def test_delete_removes_the_note_and_its_structured_versions(client: TestClient, session: Session):
    book = make_book(session)
    note = make_note(session, book, ANCHOR)
    make_artifact(session, book, type=ArtifactType.STRUCTURED_NOTE, anchor=ANCHOR, note_id=note.id)

    response = client.delete(f"{URL}/{note.id}", headers=AUTH)

    assert response.status_code == 204
    assert session.exec(select(Note)).all() == []
    assert session.exec(select(Artifact)).all() == []
    assert client.get(f"{URL}/{note.id}").status_code == 404

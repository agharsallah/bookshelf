"""Notes on a chapter's distillation or summary: validation, passages, detachment."""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.models import Artifact, Document, Job, Note
from app.models.enums import ArtifactType, JobKind, NoteTarget
from tests.api.factories import make_artifact, make_book, make_note
from tests.conftest import AUTH

URL = "/api/v1/notes"
SPAN = {"text": "Queues grow when work arrives faster.", "cites": ["ch01/s01/p001"]}
BODY = {
    "blocks": [
        {"type": "paragraph", "spans": [SPAN]},
        {"type": "paragraph", "spans": [SPAN]},
    ],
    "takeaway": SPAN,
}


def distillation(session: Session, book: Document, **overrides: object) -> Artifact:
    fields: dict[str, object] = {
        "type": ArtifactType.CHAPTER_DISTILLATION,
        "anchor": "ch01",
        "body": BODY,
    }
    return make_artifact(session, book, **(fields | overrides))  # type: ignore[arg-type]


def create(client: TestClient, artifact: Artifact, **body: object):
    payload = {
        "document_id": str(artifact.document_id),
        "anchor": artifact.anchor,
        "artifact_id": str(artifact.id),
        "block": 1,
        "range": {"start": 0, "end": 6},
        "quote": "Queues",
        **body,
    }
    return client.post(URL, json=payload, headers=AUTH)


def test_a_highlight_on_the_distillation_is_stored_with_its_passage(
    client: TestClient, session: Session
):
    artifact = distillation(session, make_book(session))

    response = create(client, artifact, color="sky")

    assert response.status_code == 201
    body = response.json()
    assert (body["target"], body["artifact_id"], body["block"], body["quote"]) == (
        "chapter_distillation",
        str(artifact.id),
        1,
        "Queues",
    )
    assert body["job"] is None  # a plain highlight: no model call
    item = client.get(URL, params={"document_id": str(artifact.document_id)}).json()["items"][0]
    assert (item["passage"], item["detached"]) == ("Queues", False)


def test_the_takeaway_callout_counts_as_a_block(client: TestClient, session: Session):
    artifact = distillation(session, make_book(session))

    assert create(client, artifact, block=2).status_code == 201  # blocks 0, 1 + takeaway
    assert create(client, artifact, block=3).status_code == 422


def test_a_note_with_words_on_the_summary_queues_structuring(client: TestClient, session: Session):
    artifact = distillation(session, make_book(session), type=ArtifactType.CHAPTER_SUMMARY)

    response = create(client, artifact, raw="Is this Little's law?")

    assert response.status_code == 201
    assert response.json()["target"] == "chapter_summary"
    job = session.exec(select(Job)).one()
    assert (job.kind, job.anchor) == (JobKind.STRUCTURE_NOTE, "ch01")


@pytest.mark.parametrize(
    ("change", "field"),
    [
        ({"anchor": "ch02"}, "body.anchor"),
        ({"quote": "Queue"}, "body.quote"),
        ({"artifact_id": str(uuid.uuid4())}, "body.artifact_id"),
    ],
)
def test_pane_notes_are_checked_against_the_artifact(
    client: TestClient, session: Session, change: dict[str, object], field: str
):
    artifact = distillation(session, make_book(session))

    response = create(client, artifact, **change)

    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["field"] == field
    assert session.exec(select(Note)).all() == []


def test_only_distillations_and_summaries_take_notes(client: TestClient, session: Session):
    artifact = distillation(session, make_book(session), type=ArtifactType.SECTION_NOTE)

    response = create(client, artifact)

    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["field"] == "body.artifact_id"


def test_pane_fields_come_together(client: TestClient, session: Session):
    artifact = distillation(session, make_book(session))

    assert create(client, artifact, range=None).status_code == 422
    assert create(client, artifact, artifact_id=None).status_code == 422


def test_a_deleted_artifact_leaves_the_note_detached_with_its_words(
    client: TestClient, session: Session
):
    book = make_book(session)
    artifact = distillation(session, book)
    note_id = create(client, artifact, raw="keep me").json()["id"]
    session.delete(artifact)
    session.commit()

    item = client.get(f"{URL}/{note_id}").json()

    assert (item["detached"], item["raw"], item["passage"]) == (True, "keep me", "Queues")


def test_source_notes_report_their_passage(client: TestClient, session: Session):
    book = make_book(session)
    make_note(session, book, "ch01/s01/p001", range={"start": 0, "end": 4})
    make_note(session, book, "ch01/s01/p002")

    items = client.get(URL, params={"document_id": str(book.id)}).json()["items"]

    assert [(i["target"], i["passage"]) for i in items] == [("source", "Text"), ("source", None)]
    assert session.exec(select(Note)).first().target is NoteTarget.SOURCE  # type: ignore[union-attr]

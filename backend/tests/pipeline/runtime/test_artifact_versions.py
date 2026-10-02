"""Superseded versions in the review queue: `superseded` on list items, `?latest=true`;
and `?body=false`, the queue's lighter list."""

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.models import Artifact, Document
from app.models.enums import ArtifactType, Origin, Review
from tests.api.factories import make_note
from tests.conftest import AUTH
from tests.pipeline.runtime.conftest import body, paragraph

API = "/api/v1/artifacts"
BODY = body(paragraph("Stocks change only through flows.", "ch01/s01/p001"))
BODY_CITES = ["ch01/s01/p001"]


def draft(session: Session, doc: Document, version: int = 1, **fields: object) -> Artifact:
    row = Artifact(
        document_id=doc.id, anchor="ch01/s01", type=ArtifactType.SECTION_NOTE, version=version,
        origin=Origin.SKILL, skill="distil-section", skill_version="1",
        input_hash=f"input-{version}", body=BODY, citations=BODY_CITES, review=Review.NEEDS_REVIEW,
    )  # fmt: skip
    for name, value in fields.items():
        setattr(row, name, value)
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def listed(api: TestClient, **params: object) -> dict[str, bool]:
    items = api.get(API, params=params).json()["items"]
    return {item["id"]: item["superseded"] for item in items}


def test_a_human_edit_supersedes_the_draft_and_latest_hides_it(api: TestClient, session, book):
    old = draft(session, book)
    edit = api.post(
        f"{API}/{old.id}/review", json={"action": "edit", "body": BODY}, headers=AUTH
    ).json()

    assert listed(api) == {edit["id"]: False, str(old.id): True}
    assert listed(api, latest=True, review="needs_review") == {}
    assert listed(api, latest=True) == {edit["id"]: False}


def test_body_false_lists_the_same_items_without_their_bodies(api: TestClient, session, book):
    old = draft(session, book)
    newer = draft(session, book, version=2)

    full = api.get(API).json()["items"]
    light = api.get(API, params={"body": False}).json()["items"]

    assert [i["body"] for i in full] == [BODY, BODY]
    assert [i["body"] for i in light] == [{}, {}]
    assert [(i["id"], i["superseded"], i["gates"]) for i in light] == [
        (str(newer.id), False, {}),
        (str(old.id), True, {}),
    ]
    assert [i["citations"] for i in full] == [BODY_CITES, BODY_CITES]
    assert [{**i, "body": {}, "citations": []} for i in full] == light


def test_body_false_keeps_the_confidence_the_queue_filters_by(api: TestClient, session, book):
    draft(session, book, body={**BODY, "confidence": "low"})

    (item,) = api.get(API, params={"body": False}).json()["items"]

    assert item["body"] == {"confidence": "low"}


def test_a_rejected_newer_version_does_not_supersede_the_live_one(api: TestClient, session, book):
    live = draft(session, book)
    draft(session, book, version=2, review=Review.REJECTED)

    assert listed(api, latest=True, review="needs_review") == {str(live.id): False}


def test_structured_notes_of_two_notes_on_one_anchor_are_separate_scopes(
    api: TestClient, session, book
):
    first, second = (make_note(session, book, "ch01/s01/p001") for _ in range(2))
    kind = ArtifactType.STRUCTURED_NOTE
    one = draft(session, book, anchor="ch01/s01/p001", type=kind, note_id=first.id)
    two = draft(session, book, 2, anchor="ch01/s01/p001", type=kind, note_id=second.id)

    assert listed(api, latest=True) == {str(two.id): False, str(one.id): False}


def test_version_history_of_a_structured_note_excludes_other_notes_on_the_anchor(
    api: TestClient, session, book
):
    first, second = (make_note(session, book, "ch01/s01/p001") for _ in range(2))
    kind = ArtifactType.STRUCTURED_NOTE
    mine = draft(session, book, anchor="ch01/s01/p001", type=kind, note_id=first.id)
    draft(session, book, 2, anchor="ch01/s01/p001", type=kind, note_id=second.id)

    versions = api.get(f"{API}/{mine.id}/versions").json()

    assert [v["id"] for v in versions] == [str(mine.id)]

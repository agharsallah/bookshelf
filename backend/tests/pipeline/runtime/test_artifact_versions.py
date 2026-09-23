"""Superseded versions in the review queue: `superseded` on list items, `?latest=true`."""

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.models import Artifact, Document
from app.models.enums import ArtifactType, Origin, Review
from tests.api.factories import make_note
from tests.conftest import AUTH
from tests.pipeline.runtime.conftest import body, paragraph

API = "/api/v1/artifacts"
BODY = body(paragraph("Stocks change only through flows.", "ch01/s01/p001"))


def draft(session: Session, doc: Document, version: int = 1, **fields: object) -> Artifact:
    row = Artifact(
        document_id=doc.id, anchor="ch01/s01", type=ArtifactType.SECTION_NOTE, version=version,
        origin=Origin.SKILL, skill="distil-section", skill_version="1",
        input_hash=f"input-{version}", body=BODY, review=Review.NEEDS_REVIEW,
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

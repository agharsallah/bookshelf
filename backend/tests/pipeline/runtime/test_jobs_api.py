"""`POST /jobs` for manual (re-)runs: skills for `derive`, notes for `structure_note`."""

import uuid
from pathlib import Path

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.models import Document
from tests.api.factories import make_note
from tests.conftest import AUTH
from tests.pipeline.runtime.conftest import write_skill

URL = "/api/v1/jobs"


def post(api: TestClient, **body: object) -> tuple[int, dict]:
    response = api.post(URL, json=body, headers=AUTH)
    return response.status_code, response.json()


def test_derive_runs_the_named_skill_and_dedupes_per_skill(api: TestClient, book: Document):
    doc = str(book.id)

    status, first = post(api, kind="derive", document_id=doc, anchor="ch01", skill="make-quiz")
    _, again = post(api, kind="derive", document_id=doc, anchor="ch01", skill="make-quiz")

    assert status == 202
    assert (first["job"]["skill"], first["deduplicated"]) == ("make-quiz", False)
    assert (again["job"]["id"], again["deduplicated"]) == (first["job"]["id"], True)


def test_two_derive_skills_on_one_scope_are_two_live_jobs(
    api: TestClient, book: Document, skills_dir: Path
):
    write_skill(skills_dir, "make-faq", job_kind="derive", artifact_type="faq",
                scope="chapter", selector="chapter_distillation", tier="distil")  # fmt: skip
    doc = str(book.id)

    _, quiz = post(api, kind="derive", document_id=doc, anchor="ch01", skill="make-quiz")
    _, faq = post(api, kind="derive", document_id=doc, anchor="ch01", skill="make-faq")

    assert faq["deduplicated"] is False
    assert (quiz["job"]["skill"], faq["job"]["skill"]) == ("make-quiz", "make-faq")


def test_derive_needs_a_known_derive_skill(api: TestClient, book: Document):
    doc = str(book.id)
    missing = post(api, kind="derive", document_id=doc, anchor="ch01")
    unknown = post(api, kind="derive", document_id=doc, anchor="ch01", skill="make-poem")
    wrong_kind = post(api, kind="derive", document_id=doc, anchor="ch01", skill="summarize")

    assert [status for status, _ in (missing, unknown, wrong_kind)] == [422, 422, 422]
    assert {body["error"]["details"][0]["field"] for _, body in (missing, unknown, wrong_kind)} == {
        "body.skill"
    }


def test_structure_note_reruns_one_note_at_its_anchor(
    api: TestClient, session: Session, book: Document
):
    first = make_note(session, book, "ch01/s01/p001")
    second = make_note(session, book, "ch01/s01/p001")
    doc = str(book.id)

    status, one = post(api, kind="structure_note", document_id=doc, note_id=str(first.id))
    _, two = post(api, kind="structure_note", document_id=doc, note_id=str(second.id), force=True)

    assert status == 202
    assert one["job"]["anchor"] == "ch01/s01/p001"
    assert one["job"]["id"] != two["job"]["id"]  # a note each, even on the same anchor
    assert two["deduplicated"] is False


def test_structure_note_needs_a_note_of_the_same_document(
    api: TestClient, session: Session, book: Document, other_book: Document
):
    foreign = make_note(session, other_book, "ch01/s01/p001")
    doc = str(book.id)

    missing = post(api, kind="structure_note", document_id=doc)
    elsewhere = post(api, kind="structure_note", document_id=doc, note_id=str(foreign.id))
    unknown = post(api, kind="structure_note", document_id=doc, note_id=str(uuid.uuid4()))

    assert [status for status, _ in (missing, elsewhere, unknown)] == [422, 422, 422]
    assert elsewhere[1]["error"]["details"][0]["field"] == "body.note_id"

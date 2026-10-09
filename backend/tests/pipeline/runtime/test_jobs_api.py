"""`POST /jobs` for manual (re-)runs: skills for `derive`, notes for `structure_note`."""

import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.jobs import queue
from app.jobs.queue import JobSpec
from app.models import Document, Job
from app.models.enums import DocumentStatus, JobKind, JobState
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


# --- Cancel and retry --------------------------------------------------------------------


def job_of(session: Session, kind: JobKind, doc: Document, anchor: str | None = None, **payload):
    job = queue.enqueue(session, JobSpec(kind=kind, document_id=doc.id, anchor=anchor,
                                         payload=payload or None))  # fmt: skip
    assert job is not None
    return job


def test_cancelling_a_queued_job_skips_it(api: TestClient, session: Session, book: Document):
    job = job_of(session, JobKind.SUMMARIZE, book, "ch01")

    response = api.delete(f"{URL}/{job.id}", headers=AUTH)

    assert response.status_code == 200
    body = response.json()
    assert (body["state"], body["error"]) == ("skipped", "cancelled by user")
    assert body["finished_at"] is not None


def test_only_queued_jobs_can_be_cancelled(api: TestClient, session: Session, book: Document):
    running = job_of(session, JobKind.SUMMARIZE, book, "ch01")
    queue.claim(session)

    assert api.delete(f"{URL}/{running.id}", headers=AUTH).status_code == 409
    assert api.delete(f"{URL}/{uuid.uuid4()}", headers=AUTH).status_code == 404


def test_cancelling_the_last_element_job_releases_the_section_notes(
    api: TestClient, session: Session, book: Document
):
    book.status = DocumentStatus.ENRICHING
    session.add(book)
    session.commit()
    code = job_of(session, JobKind.EXPLAIN_CODE, book, "ch02/c001")
    queue.complete(session, code)
    figure = job_of(session, JobKind.DESCRIBE_FIGURE, book, "ch01/s01/f001")

    api.delete(f"{URL}/{figure.id}", headers=AUTH)

    queued = session.exec(select(Job).where(Job.kind == JobKind.DISTIL_SECTION)).all()
    assert sorted(j.anchor or "" for j in queued) == ["ch01/s01", "ch01/s02", "ch02"]


@pytest.mark.parametrize(
    ("kind", "status"),
    [(JobKind.EMBED, DocumentStatus.DISTILLED), (JobKind.LINK_CONCEPTS, DocumentStatus.INDEXED)],
)
def test_a_cancelled_stage_does_not_count_as_done(
    api: TestClient, session: Session, book: Document, kind: JobKind, status: DocumentStatus
):
    """Cancelling a queued embed must not mark the document `indexed` (nothing was indexed)
    nor queue concept linking; a cancelled link job must not mark it `linked`."""
    book.status = status
    session.add(book)
    session.commit()
    job = job_of(session, kind, book)

    api.delete(f"{URL}/{job.id}", headers=AUTH)

    session.refresh(book)
    others = session.exec(select(Job).where(Job.id != job.id)).all()
    assert (book.status, others) == (status, [])


def test_retrying_a_failed_job_queues_the_same_work_without_force(
    api: TestClient, session: Session, book: Document
):
    failed = job_of(session, JobKind.SUMMARIZE, book, "ch01", force=True)
    queue.claim(session)
    queue.fail(session, failed, "CLI rate limited", retry=False)

    status, body = post_to(api, f"{URL}/{failed.id}/retry")

    assert status == 202
    again = session.get(Job, uuid.UUID(body["job"]["id"]))
    assert again is not None and again.id != failed.id
    assert (again.kind, again.anchor, again.state, again.payload) == (
        JobKind.SUMMARIZE, "ch01", JobState.QUEUED, {},
    )  # fmt: skip


def test_only_failed_jobs_can_be_retried(api: TestClient, session: Session, book: Document):
    queued = job_of(session, JobKind.SUMMARIZE, book, "ch01")

    assert post_to(api, f"{URL}/{queued.id}/retry")[0] == 409


def post_to(api: TestClient, url: str) -> tuple[int, dict]:
    response = api.post(url, headers=AUTH)
    return response.status_code, response.json()


def test_a_retried_job_whose_output_exists_is_skipped_without_a_model_call(
    api: TestClient, session: Session, book: Document, skills_dir: Path
):
    """Retry queues the work again without `force`: when its output is already there (same
    input), the new job skips for free instead of redoing it."""
    from app.pipeline.execution import execute_skill_job
    from app.pipeline.runner import FakeRunner
    from tests.pipeline.runtime.conftest import body, paragraph, reply

    first = job_of(session, JobKind.SUMMARIZE, book, "ch01")
    queue.claim(session)
    session.refresh(first)
    grounded = reply(body(paragraph("A stock remembers its flows.", "ch01/s01/p001")))
    execute_skill_job(session, first, runner=FakeRunner(grounded), skills_dir=skills_dir)
    queue.fail(session, first, "lost after the output was saved", retry=False)

    again_id = api.post(f"{URL}/{first.id}/retry", headers=AUTH).json()["job"]["id"]
    again = session.get(Job, uuid.UUID(again_id))
    assert again is not None and "force" not in (again.payload or {})
    queue.claim(session)
    session.refresh(again)
    never = FakeRunner(lambda _p: pytest.fail("a retry must not call the model for done work"))
    outcome = execute_skill_job(session, again, runner=never, skills_dir=skills_dir)

    assert outcome.state is JobState.SKIPPED
    assert outcome.result["reason"] == "unchanged input"

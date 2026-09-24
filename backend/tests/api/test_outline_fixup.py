"""The outline fix-up loop (§8): override → its own re-parse → pipeline, or confirm as is."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlmodel import Session, select

from app.jobs import queue
from app.jobs.queue import JobSpec
from app.jobs.registry import JobContext
from app.models import Document, Job
from app.models.enums import DocumentKind, DocumentStatus, JobKind, JobState
from app.pipeline import orchestrator
from app.pipeline.handlers import parse as parse_handler
from app.schemas.outline import OUTLINE_OVERRIDE
from tests.api.factories import make_book
from tests.conftest import AUTH
from tests.pipeline.parse.builders import book_pdf

URL = "/api/v1/documents"
OUTLINE = [
    {"title": "Chapter 1 Stocks", "page_from": 1,
     "sections": [{"title": "1.1 Flows", "page_from": 1}]},
    {"title": "Chapter 2 Loops", "page_from": 2},
]  # fmt: skip


@pytest.fixture
def guessed(session: Session, library_dir: Path) -> Document:
    """A PDF without an outline, parsed: tier 2, waiting for a human in `needs_review`."""
    book_pdf(library_dir / "untitled.pdf", toc=False)
    doc = Document(kind=DocumentKind.PDF, slug="untitled", title="untitled", sha256="d" * 64,
                   source_path="library/untitled.pdf")  # fmt: skip
    session.add(doc)
    session.commit()
    run_parse(session, queue.enqueue(session, JobSpec(kind=JobKind.PARSE, document_id=doc.id)))
    session.refresh(doc)
    assert doc.status is DocumentStatus.NEEDS_REVIEW
    return doc


def run_parse(session: Session, job: Job | None) -> Job:
    """What the worker does: claim, handle, complete, then let the orchestrator advance."""
    assert job is not None
    queue.claim(session, [JobKind.PARSE])
    session.refresh(job)
    outcome = parse_handler.run_parse(JobContext(session=session, job=job))
    queue.complete(session, job, state=outcome.state, result=outcome.result)
    orchestrator.on_job_done(session, job)
    return job


def kinds_queued(session: Session) -> set[JobKind]:
    return {j.kind for j in session.exec(select(Job).where(Job.state == JobState.QUEUED))}


def test_an_override_during_a_running_parse_gets_its_own_parse_job(
    client: TestClient, session: Session
):
    doc = make_book(session, page_count=3)
    running = queue.enqueue(session, JobSpec(kind=JobKind.PARSE, document_id=doc.id))
    queue.claim(session)
    patch = f"{URL}/{doc.slug}/outline"

    first = client.patch(patch, json={"chapters": OUTLINE}, headers=AUTH).json()
    again = client.patch(patch, json={"chapters": OUTLINE}, headers=AUTH).json()

    assert running is not None and first["job"]["id"] != str(running.id)
    assert (first["deduplicated"], again["deduplicated"]) == (False, True)
    assert again["job"]["id"] == first["job"]["id"]


def test_a_parse_whose_outline_changed_meanwhile_leaves_the_tree_to_the_newer_job(
    session: Session, guessed: Document, monkeypatch
):
    real_parse = parse_handler.parse_file

    def human_edits_during_parse(*args, **kwargs):
        parsed = real_parse(*args, **kwargs)
        with Session(session.get_bind()) as other:
            doc = other.get(Document, guessed.id)
            assert doc is not None
            doc.outline_override = OUTLINE
            other.add(doc)
            other.commit()
        return parsed

    monkeypatch.setattr(parse_handler, "parse_file", human_edits_during_parse)
    stale = queue.enqueue(session, JobSpec(kind=JobKind.PARSE, document_id=guessed.id))

    assert run_parse(session, stale).state is JobState.SKIPPED
    assert kinds_queued(session) == set()  # nothing advances on a stale tree


def test_after_the_override_parse_the_pipeline_starts(
    client: TestClient, session: Session, guessed: Document
):
    body = client.patch(f"{URL}/{guessed.slug}/outline", json={"chapters": OUTLINE}, headers=AUTH)

    run_parse(session, session.get(Job, body.json()["job"]["id"]))

    session.refresh(guessed)
    assert guessed.status in (DocumentStatus.ENRICHING, DocumentStatus.DISTILLING)
    assert JobKind.SUMMARIZE in kinds_queued(session)


def test_confirming_a_guessed_outline_starts_the_pipeline(
    client: TestClient, session: Session, guessed: Document
):
    response = client.post(f"{URL}/{guessed.slug}/outline/confirm", headers=AUTH)

    assert response.status_code == 200
    body = response.json()
    assert body["document"]["status"] in ("enriching", "distilling")
    assert "summarize" in {job["kind"] for job in body["jobs"]}


def test_only_an_outline_waiting_for_review_can_be_confirmed(client: TestClient, session):
    doc = make_book(session)  # registered, never parsed

    response = client.post(f"{URL}/{doc.slug}/outline/confirm", headers=AUTH)

    assert response.status_code == 409


def test_the_api_takes_the_parser_shape_page_to_optional_and_skip(client: TestClient, session):
    doc = make_book(session, page_count=30)
    chapters = [
        {"title": "Body", "page_from": 1},
        {"title": "Index", "page_from": 25, "skip": True},
    ]

    response = client.patch(f"{URL}/{doc.slug}/outline", json={"chapters": chapters}, headers=AUTH)

    assert response.status_code == 202
    session.refresh(doc)
    assert doc.outline_override == [
        {"title": "Body", "page_from": 1, "skip": False, "sections": []},
        {"title": "Index", "page_from": 25, "skip": True, "sections": []},
    ]


def test_the_parser_rejects_overlapping_chapters_like_the_api_does():
    with pytest.raises(ValidationError, match="starts before"):
        OUTLINE_OVERRIDE.validate_python(
            [{"title": "A", "page_from": 1, "page_to": 10}, {"title": "B", "page_from": 9}]
        )


def test_a_section_past_the_last_page_is_rejected_when_its_chapter_is_open_ended(
    client: TestClient, session
):
    doc = make_book(session, page_count=30)
    chapters = [{"title": "Body", "page_from": 1, "sections": [{"title": "Late", "page_from": 31}]}]

    response = client.patch(f"{URL}/{doc.slug}/outline", json={"chapters": chapters}, headers=AUTH)

    assert response.status_code == 422

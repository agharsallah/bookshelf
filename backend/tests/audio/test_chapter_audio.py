"""A chapter read aloud, end to end: queueing it (`POST /jobs {kind: narrate, anchor}`),
recording it (the `narrate` job on `FakeSpeechRunner`) and listing it
(`GET /documents/{ref}/audio/read/{anchor}`)."""

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.audio import store
from app.audio.render import narrate
from app.audio.runner import FakeSpeechRunner
from app.core.config import Settings
from app.jobs import queue
from app.jobs.queue import JobSpec
from app.jobs.registry import PermanentJobError
from app.models import Document, Job, Node
from app.models.enums import JobKind, JobState
from tests.conftest import AUTH

API = "/api/v1"
READER = ["custom-ben"]


def post(api: TestClient, **body: Any) -> tuple[int, dict]:
    response = api.post(f"{API}/jobs", json=body, headers=AUTH)
    return response.status_code, response.json()


def error_field(body: dict) -> str:
    return body["error"]["details"][0]["field"]


def read_aloud(
    session: Session, doc: Document, settings: Settings, runner: FakeSpeechRunner, **payload: Any
):
    """Run one reading job, then close it as the worker would (so the next is not deduped)."""
    job = queue.enqueue(
        session,
        JobSpec(
            kind=JobKind.NARRATE,
            document_id=doc.id,
            payload={"anchor": "ch01", "voices": READER, **payload},
        ),
    )
    assert job is not None
    try:
        return narrate(session, job, runner=runner, settings=settings)
    finally:
        queue.complete(session, job)


def reword(session: Session, doc: Document, anchor: str, text: str) -> None:
    node = session.exec(select(Node).where(Node.document_id == doc.id, Node.anchor == anchor)).one()
    node.text = text
    session.add(node)
    session.commit()


# --- Recording -------------------------------------------------------------------------


def test_a_chapter_is_recorded_in_its_own_words_part_by_heading(
    session: Session, book: Document, settings: Settings
):
    runner = FakeSpeechRunner()

    outcome = read_aloud(session, book, settings, runner)

    (saved,) = store.list_renders(settings.audio_dir, book.id, "read~ch01")
    (request,) = runner.calls
    assert outcome.state is JobState.DONE
    assert outcome.result is not None
    assert outcome.result["anchor"] == "ch01"
    assert "artifact_id" not in outcome.result
    assert saved.voices == tuple(READER)
    assert saved.content != ""
    assert request.voices == (settings.voices_dir / "custom" / "ben.wav",)
    assert [s.title for s in request.sections] == ["Stocks and flows", "Stocks", "Flows"]
    assert [t.text for t in request.sections[1].turns] == [
        "Stocks.",
        "A stock is the memory of the history of flows.",
        "Figure 1.1 A bathtub.",
    ]
    opening = request.sections[0].turns[0].text
    assert opening == f"This is an AI-generated reading of {book.title}. Stocks and flows."


def test_the_same_words_and_voice_again_are_a_free_skip_but_new_words_record_anew(
    session: Session, book: Document, settings: Settings
):
    runner = FakeSpeechRunner()
    read_aloud(session, book, settings, runner)

    again = read_aloud(session, book, settings, runner)
    reword(session, book, "ch01/s02/p001", "Flows fill and drain stocks.")
    reparsed = read_aloud(session, book, settings, runner)

    assert again.state is JobState.SKIPPED
    assert reparsed.state is JobState.DONE
    assert len(runner.calls) == 2
    assert len(store.list_renders(settings.audio_dir, book.id, "read~ch01")) == 2


def test_only_a_chapter_or_section_of_the_jobs_document_can_be_read(
    session: Session, book: Document, settings: Settings
):
    for anchor in ("ch01/s01/p001", "ch99"):
        with pytest.raises(PermanentJobError, match="nothing to narrate"):
            read_aloud(session, book, settings, FakeSpeechRunner(), anchor=anchor)


# --- Queueing ----------------------------------------------------------------------------


def test_reading_a_chapter_queues_one_voice_scoped_to_its_anchor(api, session, book: Document):
    status, body = post(api, kind="narrate", document_id=str(book.id), anchor="ch01")
    _, twice = post(api, kind="narrate", document_id=str(book.id), anchor="ch01")
    _, recast = post(
        api, kind="narrate", document_id=str(book.id), anchor="ch01", voices=["custom-ben"]
    )

    session.expire_all()
    job = session.get(Job, body["job"]["id"])
    assert status == 202
    assert job is not None
    assert (job.anchor, job.payload) == ("ch01", {"anchor": "ch01", "voices": ["alice"]})
    assert job.input_hash == "narrate:read:ch01:alice"
    assert twice["deduplicated"] is True
    assert recast["job"]["id"] != body["job"]["id"]


@pytest.mark.parametrize(
    ("extra", "field"),
    [
        ({"anchor": "ch01", "voices": ["alice", "frank"]}, "body.voices"),
        ({"anchor": "ch01", "voices": ["nobody"]}, "body.voices"),
        ({"anchor": "ch01/s01/p001"}, "body.anchor"),
        ({"anchor": "ch99"}, "body.anchor"),
        ({"anchor": "ch02/c001"}, "body.anchor"),
    ],
    ids=["two-voices", "unknown-voice", "a-paragraph", "missing", "code-only"],
)
def test_a_bad_reading_request_is_422_on_the_field_at_fault(api, book: Document, extra, field):
    status, body = post(api, kind="narrate", document_id=str(book.id), **extra)

    assert (status, error_field(body)) == (422, field)


def test_a_reading_needs_its_document(api):
    status, body = post(api, kind="narrate", anchor="ch01")

    assert (status, error_field(body)) == (422, "body.document_id")


# --- Listing -----------------------------------------------------------------------------


def test_a_chapter_lists_its_script_and_only_recordings_of_its_current_words(
    api: TestClient, session: Session, book: Document, settings: Settings
):
    read_aloud(session, book, settings, FakeSpeechRunner())
    empty = api.get(f"{API}/documents/{book.slug}/audio/read/ch01/s02").json()
    before = api.get(f"{API}/documents/{book.slug}/audio/read/ch01").json()

    reword(session, book, "ch01/s01/p001", "A stock is memory.")
    after = api.get(f"{API}/documents/{book.slug}/audio/read/ch01").json()

    assert (before["anchor"], before["title"]) == ("ch01", "Stocks and flows")
    assert [s["title"] for s in before["script"]["sections"]] == [
        "Stocks and flows",
        "Stocks",
        "Flows",
    ]
    assert before["script"]["sections"][1]["turns"][1]["cites"] == ["ch01/s01/p001"]
    assert before["words"] == 27
    (render,) = before["renders"]
    assert render["voices"] == READER
    assert render["url"].startswith(f"audio/files/{book.id}/read~ch01/")
    assert empty["renders"] == []
    assert after["renders"] == []


def test_a_chapter_that_is_not_there_is_404(api: TestClient, book: Document):
    assert api.get(f"{API}/documents/{book.slug}/audio/read/ch99").status_code == 404
    assert api.get(f"{API}/documents/{book.slug}/audio/read/ch01/s01/p001").status_code == 404
    assert api.get(f"{API}/documents/nope/audio/read/ch01").status_code == 404

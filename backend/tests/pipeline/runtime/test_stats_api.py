"""`GET /documents/{ref}/stats` and `GET /stats` over jobs that really ran (fake CLI)."""

from pathlib import Path

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.jobs import queue
from app.models import Document, Job
from app.models.enums import JobKind
from app.pipeline.execution import execute_skill_job
from app.pipeline.runner import FakeRunner
from app.telemetry.recorder import recorded
from tests.pipeline.runtime.conftest import body, paragraph, reply

GROUNDED = reply(body(paragraph("A stock remembers its flows.", "ch01/s01/p001")))


def run_job(session: Session, job: Job, skills_dir: Path, runner: FakeRunner) -> None:
    """What the worker does with one claimed job."""
    queue.claim(session)
    session.refresh(job)
    outcome = execute_skill_job(session, job, runner=recorded(runner, job), skills_dir=skills_dir)
    queue.complete(session, job, state=outcome.state, result=outcome.result,
                   cost_tokens=outcome.cost_tokens)  # fmt: skip


def test_a_books_stats_cover_its_size_chapters_stages_and_skills(
    api: TestClient, session: Session, book: Document, make_job, skills_dir: Path
):
    run_job(session, make_job(JobKind.SUMMARIZE, book, "ch01"), skills_dir, FakeRunner(GROUNDED))
    failed = make_job(JobKind.SUMMARIZE, book, "ch02")
    queue.claim(session)
    queue.fail(session, failed, "claude timed out after 900s", retry=False)
    make_job(JobKind.DISTIL_SECTION, book, "ch01/s01")  # still queued

    response = api.get(f"/api/v1/documents/{book.slug}/stats")

    assert response.status_code == 200
    stats = response.json()
    assert stats["book"]["slug"] == book.slug
    assert stats["book"]["chapters"] == 2
    assert stats["book"]["elements"] == {"figure": 1, "code": 1}
    assert stats["book"]["words"] > 20
    assert (stats["jobs"]["done"], stats["jobs"]["failed"], stats["jobs"]["queued"]) == (1, 1, 1)
    assert stats["tokens"]["tokens"] == 10  # FakeRunner's cost per call
    assert stats["tokens"]["tracked_calls"] == 1

    ch01, ch02 = stats["chapters"]
    assert (ch01["anchor"], ch01["sections"], ch01["elements"]) == ("ch01", 2, 1)
    assert ch01["words"] == 22  # 10 + 8 paragraph words and the 4-word figure caption
    assert ch01["jobs"]["done"] == 1 and ch01["calls"] == 1
    assert ch02["jobs"]["failed"] == 1

    [summarize] = [s for s in stats["skills"] if s["skill"] == "summarize"]
    assert summarize["failure_rate"] == 0.5
    assert summarize["errors"] == [{"name": "claude timed out after #s", "count": 1}]
    assert summarize["grounding_mean"] == 1.0

    assert stats["end_to_end"]["stages"][0]["kind"] == "summarize"
    assert stats["remaining"]["queued"] == 1
    assert stats["models"][0]["model"] == "fake-model-1"


def test_the_library_lists_every_book_with_its_totals(
    api: TestClient, session: Session, book: Document, other_book: Document, make_job,
    skills_dir: Path,
):  # fmt: skip
    run_job(session, make_job(JobKind.SUMMARIZE, book, "ch01"), skills_dir, FakeRunner(GROUNDED))

    stats = api.get("/api/v1/stats").json()

    rows = {row["book"]["slug"]: row for row in stats["books"]}
    assert set(rows) == {book.slug, other_book.slug}
    assert rows[book.slug]["tokens"]["tokens"] == 10
    assert rows[book.slug]["book"]["pages"] == 10
    assert rows[book.slug]["efficiency"]["tokens_per_page"] == 1.0
    assert rows[other_book.slug]["jobs"]["total"] == 0
    assert stats["jobs"]["done"] == 1
    assert [s["skill"] for s in stats["skills"]] == ["summarize"]


def test_an_unknown_book_is_a_404(api: TestClient):
    assert api.get("/api/v1/documents/no-such-book/stats").status_code == 404

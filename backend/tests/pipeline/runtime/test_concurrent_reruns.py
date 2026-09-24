"""A re-run requested while the same job is running is queued, waits, then runs (§7).

The live-work dedupe covers only *queued* jobs, and `claim()` never starts a job while an
identical one runs, so a human approval that lands mid-run is never swallowed by it.
"""

from pathlib import Path

from fastapi.testclient import TestClient
from sqlmodel import Session, col, select

from app.db.session import engine
from app.jobs import queue
from app.jobs.queue import JobSpec
from app.jobs.registry import JobContext
from app.jobs.worker import Worker
from app.models import Artifact, Document, Job
from app.models.enums import ArtifactType, DocumentStatus, JobKind, Origin
from app.pipeline.execution import execute_skill_job
from app.pipeline.runner import FakeRunner
from tests.conftest import AUTH
from tests.pipeline.runtime.conftest import body, paragraph, reply

CHAPTER = reply(body(paragraph("Stocks change only through flows.", "ch01/s01/p001")))
EDITED = "Flows are rates; a stock integrates them."


def _note(session: Session, doc: Document, anchor: str, text: str) -> Artifact:
    artifact = Artifact(
        document_id=doc.id, anchor=anchor, type=ArtifactType.SECTION_NOTE, version=1,
        origin=Origin.SKILL, skill="distil-section", skill_version="1",
        input_hash=f"note-{anchor}", body=body(paragraph(text, f"{anchor}/p001")),
    )  # fmt: skip
    session.add(artifact)
    session.commit()
    return artifact


def test_a_section_approved_while_its_chapter_distils_re_distils_the_chapter_afterwards(
    session: Session, book: Document, api: TestClient, skills_dir: Path
):
    book.status = DocumentStatus.DISTILLING
    session.add(book)
    session.commit()
    _note(session, book, "ch01/s01", "A stock is memory.")
    flows = _note(session, book, "ch01/s02", "Flows change stocks.")
    queue.enqueue(session, JobSpec(kind=JobKind.DISTIL_CHAPTER, document_id=book.id, anchor="ch01"))
    started_meanwhile: list[Job | None] = []

    def model(prompt: str) -> str:
        if EDITED not in prompt:  # the first run: a human edits a section note mid-run
            edit = {"action": "edit", "body": body(paragraph(EDITED, "ch01/s02/p001"))}
            response = api.post(f"/api/v1/artifacts/{flows.id}/review", json=edit, headers=AUTH)
            assert response.status_code == 200, response.text
            with Session(engine) as other:  # the re-run is queued but may not start yet
                started_meanwhile.append(queue.claim(other, [JobKind.DISTIL_CHAPTER]))
        return CHAPTER

    runner = FakeRunner(model)

    def distil(ctx: JobContext):
        return execute_skill_job(ctx.session, ctx.job, runner=runner, skills_dir=skills_dir)

    worker = Worker(concurrency=2, poll_seconds=0.01, handlers={JobKind.DISTIL_CHAPTER: distil})

    assert worker.run(once=True) == 2
    assert started_meanwhile == [None]
    chapters = session.exec(
        select(Artifact)
        .where(Artifact.type == ArtifactType.CHAPTER_DISTILLATION)
        .order_by(col(Artifact.version))
    ).all()
    assert [a.version for a in chapters] == [1, 2]
    assert EDITED in runner.calls[1]["prompt"]  # the re-run read the corrected note

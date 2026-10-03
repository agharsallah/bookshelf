"""Steering the queue: kinds that go first, wait or are skipped, and books that go first."""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.jobs import queue
from app.jobs.queue import JobSpec
from app.jobs.registry import HandlerResult, JobContext
from app.jobs.worker import Worker
from app.models import Document, Job
from app.models.enums import DocumentStatus, JobKind, JobState
from app.services.app_settings import QueueControls, set_queue_controls
from tests.conftest import AUTH
from tests.pipeline.runtime.conftest import add_document

URL = "/api/v1/jobs/queue"


def enqueue(
    session: Session, kind: JobKind, anchor: str, *, doc: Document | None = None, priority: int
) -> Job:
    spec = JobSpec(kind=kind, anchor=anchor, document_id=doc.id if doc else None, priority=priority)
    job = queue.enqueue(session, spec)
    assert job is not None
    return job


def steer(session: Session, **values: object) -> None:
    set_queue_controls(session, QueueControls(**values))  # type: ignore[arg-type]


def claimed_anchors(session: Session) -> list[str | None]:
    anchors = []
    while (job := queue.claim(session)) is not None:
        anchors.append(job.anchor)
    return anchors


def test_a_kind_set_first_goes_before_work_the_pipeline_ranks_higher(session: Session):
    enqueue(session, JobKind.DESCRIBE_FIGURE, "figure", priority=40)
    enqueue(session, JobKind.EMBED, "embed", priority=110)
    steer(session, kinds={JobKind.EMBED: "first"})

    assert claimed_anchors(session) == ["embed", "figure"]


def test_a_first_book_goes_first_and_a_first_kind_of_it_before_either(session: Session):
    shelf, wanted = add_document(session, slug="shelf"), add_document(session, slug="wanted")
    enqueue(session, JobKind.DESCRIBE_FIGURE, "other book", doc=shelf, priority=40)
    enqueue(session, JobKind.EMBED, "first kind only", doc=shelf, priority=110)
    enqueue(session, JobKind.SUMMARIZE, "first book only", doc=wanted, priority=60)
    enqueue(session, JobKind.EMBED, "both", doc=wanted, priority=110)
    steer(session, kinds={JobKind.EMBED: "first"}, first_documents=(wanted.id,))

    order = claimed_anchors(session)

    assert order[0] == "both"
    assert order[-1] == "other book"
    assert queue.positions(session) == {}  # all claimed


def test_a_held_kind_waits_last_in_line_until_a_person_runs_one_now(session: Session):
    held = enqueue(session, JobKind.DESCRIBE_FIGURE, "figure", priority=40)
    other = enqueue(session, JobKind.SUMMARIZE, "summary", priority=60)
    steer(session, kinds={JobKind.DESCRIBE_FIGURE: "hold"})

    assert queue.positions(session) == {other.id: 1, held.id: 2}
    assert queue.claim(session) == other
    assert queue.claim(session) is None

    queue.run_now(session, held.id)
    assert queue.claim(session) == held


def test_a_skipped_kind_is_dropped_without_running_and_ignores_the_cap(session: Session):
    figure = enqueue(session, JobKind.DESCRIBE_FIGURE, "figure", priority=40)
    steer(session, kinds={JobKind.DESCRIBE_FIGURE: "skip"}, max_running=1)
    running = enqueue(session, JobKind.EXPORT, "busy", priority=10)
    assert queue.claim(session, [JobKind.EXPORT]) == running  # the one capped slot is taken
    ran: list[str] = []
    done: list[tuple[JobState, str | None]] = []

    def describe(ctx: JobContext) -> HandlerResult:
        ran.append(ctx.job.anchor or "")
        return HandlerResult()

    worker = Worker(concurrency=1, poll_seconds=0.01, handlers={JobKind.DESCRIBE_FIGURE: describe},
                    on_done=lambda _db, job: done.append((job.state, job.error)))  # fmt: skip
    worker.run(once=True)

    session.refresh(figure)
    assert ran == []
    assert (figure.state, figure.error) == (JobState.SKIPPED, queue.TURNED_OFF)
    assert done == [(JobState.SKIPPED, queue.TURNED_OFF)]


def test_skipping_the_last_figure_releases_the_section_notes(session: Session, book: Document):
    book.status = DocumentStatus.ENRICHING
    session.add(book)
    session.commit()
    code = queue.enqueue(session, JobSpec(kind=JobKind.EXPLAIN_CODE, document_id=book.id,
                                          anchor="ch02/c001"))  # fmt: skip
    assert code is not None
    queue.complete(session, code)
    figure = queue.enqueue(session, JobSpec(kind=JobKind.DESCRIBE_FIGURE, document_id=book.id,
                                            anchor="ch01/s01/f001"))  # fmt: skip
    assert figure is not None
    steer(session, kinds={JobKind.DESCRIBE_FIGURE: "skip"})

    Worker(concurrency=1, poll_seconds=0.01, handlers={JobKind.DESCRIBE_FIGURE: lambda _c: None},
           only=[JobKind.DESCRIBE_FIGURE]).run(once=True)  # type: ignore[dict-item]  # fmt: skip

    notes = session.exec(select(Job).where(Job.kind == JobKind.DISTIL_SECTION)).all()
    assert sorted(j.anchor or "" for j in notes) == ["ch01/s01", "ch01/s02", "ch02"]


def test_the_api_merges_kind_modes_and_says_which_kinds_may_be_skipped(
    session: Session, client: TestClient
):
    enqueue(session, JobKind.DESCRIBE_FIGURE, "a", priority=40)
    enqueue(session, JobKind.DESCRIBE_FIGURE, "b", priority=40)

    client.patch(URL, json={"kinds": {"embed": "first", "describe_figure": "skip"}}, headers=AUTH)
    status = client.patch(URL, json={"kinds": {"embed": None}}, headers=AUTH).json()

    assert status["kinds"] == {"describe_figure": "skip"}
    assert "describe_figure" in status["skippable_kinds"]
    assert "embed" not in status["skippable_kinds"]
    assert status["queued_kinds"] == {"describe_figure": 2}


def test_the_api_refuses_to_skip_a_kind_its_stage_waits_for(client: TestClient):
    response = client.patch(URL, json={"kinds": {"embed": "skip"}}, headers=AUTH)

    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["field"] == "kinds.embed"


def test_the_api_sets_the_first_books_and_refuses_unknown_ones(
    session: Session, client: TestClient
):
    wanted = add_document(session, slug="wanted")

    status = client.patch(URL, json={"first_documents": [str(wanted.id)]}, headers=AUTH)
    unknown = client.patch(URL, json={"first_documents": [str(uuid.uuid4())]}, headers=AUTH)
    cleared = client.patch(URL, json={"first_documents": []}, headers=AUTH)

    assert status.json()["first_documents"] == [str(wanted.id)]
    assert unknown.status_code == 422
    assert cleared.json()["first_documents"] == []

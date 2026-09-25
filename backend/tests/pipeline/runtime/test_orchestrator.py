"""The §7 state machine, one rule at a time."""

import pytest
from sqlmodel import Session, select

from app.jobs import queue
from app.models import Artifact, Document, Job, Node
from app.models.enums import (
    ArtifactType,
    DocumentStatus,
    JobKind,
    JobState,
    NodeKind,
    Origin,
    Review,
)
from app.pipeline import orchestrator
from tests.pipeline.runtime.conftest import BOOK, add_document, add_nodes, body, paragraph


def queued(session: Session) -> set[tuple[JobKind, str | None]]:
    rows = session.exec(select(Job).where(Job.state == JobState.QUEUED)).all()
    return {(j.kind, j.anchor) for j in rows}


def finish(session: Session, job: Job, state: JobState = JobState.DONE) -> Job:
    if state is JobState.FAILED:
        queue.fail(session, job, "boom", retry=False)
    else:
        queue.complete(session, job, state=state)
    return job


def finish_all(session: Session) -> None:
    for job in session.exec(select(Job).where(Job.state == JobState.QUEUED)).all():
        finish(session, job)


def status(session: Session, doc: Document) -> DocumentStatus:
    session.refresh(doc)
    return doc.status


def store(session: Session, doc: Document, kind: ArtifactType, anchor: str | None,
          review: Review = Review.DRAFT) -> Artifact:  # fmt: skip
    artifact = Artifact(
        document_id=doc.id, anchor=anchor, type=kind, version=1, origin=Origin.SKILL,
        skill="t", skill_version="1", input_hash=f"{kind}{anchor}", review=review,
        body=body(paragraph("x", "ch02/p001")),
    )  # fmt: skip
    session.add(artifact)
    session.commit()
    return artifact


def test_parsed_document_gets_element_jobs_and_summaries_first(session, book, make_job):
    parse = finish(session, make_job(JobKind.PARSE, book))

    orchestrator.on_job_done(session, parse)

    assert queued(session) - {(JobKind.PARSE, None)} == {
        (JobKind.DESCRIBE_FIGURE, "ch01/s01/f001"),
        (JobKind.EXPLAIN_CODE, "ch02/c001"),
        (JobKind.SUMMARIZE, "ch01"),
        (JobKind.SUMMARIZE, "ch02"),
    }
    assert status(session, book) is DocumentStatus.ENRICHING


def test_document_without_elements_goes_straight_to_section_notes(session, make_job):
    doc = add_document(session)
    add_nodes(session, doc, [n for n in BOOK if n[1] not in (NodeKind.FIGURE, NodeKind.CODE)])

    orchestrator.on_job_done(session, finish(session, make_job(JobKind.PARSE, doc)))

    assert queued(session) == {
        (JobKind.SUMMARIZE, "ch01"), (JobKind.SUMMARIZE, "ch02"),
        (JobKind.DISTIL_SECTION, "ch01/s01"), (JobKind.DISTIL_SECTION, "ch01/s02"),
        (JobKind.DISTIL_SECTION, "ch02"),  # a chapter without sections is its own scope
    }  # fmt: skip
    assert status(session, doc) is DocumentStatus.DISTILLING


@pytest.mark.parametrize(("words", "distilled"), [(6, False), (200, True)])
def test_thin_front_matter_is_not_distilled_but_a_real_preface_is(
    session, make_job, words, distilled
):
    doc = add_document(session)
    front = [
        ("fm01", NodeKind.CHAPTER, "Front matter", {"front_matter": True}),
        ("fm01/p001", NodeKind.PARAGRAPH, " ".join(["word"] * words), {}),
    ]
    plain = [n for n in BOOK if n[1] not in (NodeKind.FIGURE, NodeKind.CODE)]
    add_nodes(session, doc, front + plain)

    orchestrator.on_job_done(session, finish(session, make_job(JobKind.PARSE, doc)))

    jobs = queued(session)
    assert ((JobKind.SUMMARIZE, "fm01") in jobs) is distilled
    assert ((JobKind.DISTIL_SECTION, "fm01") in jobs) is distilled
    assert (JobKind.SUMMARIZE, "ch01") in jobs


def test_a_guessed_outline_blocks_the_pipeline(session, make_job):
    doc = add_document(session, status=DocumentStatus.NEEDS_REVIEW)
    add_nodes(session, doc, BOOK)

    assert orchestrator.on_job_done(session, finish(session, make_job(JobKind.PARSE, doc))) == []
    assert status(session, doc) is DocumentStatus.NEEDS_REVIEW


def test_section_notes_wait_for_the_last_element_job_even_a_failed_one(session, book, make_job):
    figure = make_job(JobKind.DESCRIBE_FIGURE, book, "ch01/s01/f001")
    code = make_job(JobKind.EXPLAIN_CODE, book, "ch02/c001")

    assert orchestrator.on_job_done(session, finish(session, figure)) == []
    enqueued = orchestrator.on_job_done(session, finish(session, code, JobState.FAILED))

    assert {(j.kind, j.anchor) for j in enqueued} == {
        (JobKind.DISTIL_SECTION, "ch01/s01"), (JobKind.DISTIL_SECTION, "ch01/s02"),
        (JobKind.DISTIL_SECTION, "ch02"),
    }  # fmt: skip
    assert status(session, book) is DocumentStatus.DISTILLING


def test_chapter_is_distilled_once_all_its_section_notes_exist(session, book, make_job):
    store(session, book, ArtifactType.SECTION_NOTE, "ch01/s01")
    first = finish(session, make_job(JobKind.DISTIL_SECTION, book, "ch01/s01"))
    assert orchestrator.on_job_done(session, first) == []

    store(session, book, ArtifactType.SECTION_NOTE, "ch01/s02")
    second = finish(session, make_job(JobKind.DISTIL_SECTION, book, "ch01/s02"), JobState.SKIPPED)
    enqueued = orchestrator.on_job_done(session, second)

    assert [(j.kind, j.anchor) for j in enqueued] == [(JobKind.DISTIL_CHAPTER, "ch01")]


def test_brief_waits_for_every_chapter_distillation(session, book, make_job):
    store(session, book, ArtifactType.CHAPTER_DISTILLATION, "ch01")
    assert (
        orchestrator.on_job_done(
            session, finish(session, make_job(JobKind.DISTIL_CHAPTER, book, "ch01"))
        )
        == []
    )

    store(session, book, ArtifactType.CHAPTER_DISTILLATION, "ch02")
    enqueued = orchestrator.on_job_done(
        session, finish(session, make_job(JobKind.DISTIL_CHAPTER, book, "ch02"))
    )

    assert [(j.kind, j.anchor, j.skill) for j in enqueued] == [
        (JobKind.BRIEF, None, None),
        (JobKind.DERIVE, None, orchestrator.GUIDE_SKILL),
    ]


def test_approving_the_brief_marks_distilled_and_queues_embedding(session, book):
    brief = store(session, book, ArtifactType.BOOK_BRIEF, None, Review.APPROVED)

    enqueued = orchestrator.on_review(session, brief)

    assert [(j.kind, j.anchor) for j in enqueued] == [(JobKind.EMBED, None)]
    assert status(session, book) is DocumentStatus.DISTILLED


def test_approving_a_guide_re_indexes_an_indexed_document_only(session, book):
    guide = store(session, book, ArtifactType.BOOK_GUIDE, None, Review.APPROVED)
    assert orchestrator.on_review(session, guide) == []

    book.status = DocumentStatus.LINKED
    session.add(book)
    session.commit()
    enqueued = orchestrator.on_review(session, guide)

    assert [(j.kind, j.anchor) for j in enqueued] == [(JobKind.EMBED, None)]


def test_a_re_run_brief_that_hits_its_approved_version_resumes_indexing(session, book, make_job):
    """After a re-parse the document is `parsed` again and every stage re-runs; an unchanged
    brief is an idempotency skip onto the approved row, which must count as that approval
    (else the document stalls at `distilling` and its changed blocks are never re-indexed)."""
    brief = store(session, book, ArtifactType.BOOK_BRIEF, None, Review.APPROVED)
    job = make_job(JobKind.BRIEF, book)
    queue.complete(session, job, state=JobState.SKIPPED, result={"artifact_id": str(brief.id)})

    enqueued = orchestrator.on_job_done(session, job)

    assert [(j.kind, j.anchor) for j in enqueued] == [(JobKind.EMBED, None)]
    assert status(session, book) is DocumentStatus.DISTILLED


def test_a_brief_run_waiting_for_its_approval_advances_nothing(session, book, make_job):
    draft = store(session, book, ArtifactType.BOOK_BRIEF, None)
    job = make_job(JobKind.BRIEF, book)
    queue.complete(session, job, result={"artifact_id": str(draft.id)})

    assert orchestrator.on_job_done(session, job) == []
    assert status(session, book) is DocumentStatus.PARSED


def test_a_draft_brief_does_not_advance_anything(session, book):
    assert (
        orchestrator.on_review(session, store(session, book, ArtifactType.BOOK_BRIEF, None)) == []
    )


def test_embedding_then_linking_move_the_document_to_linked(session, book, make_job):
    after_embed = orchestrator.on_job_done(session, finish(session, make_job(JobKind.EMBED, book)))
    assert [(j.kind, j.anchor) for j in after_embed] == [(JobKind.LINK_CONCEPTS, None)]
    assert status(session, book) is DocumentStatus.INDEXED

    finish_all(session)
    link = session.exec(select(Job).where(Job.kind == JobKind.LINK_CONCEPTS)).one()
    orchestrator.on_job_done(session, link)
    assert status(session, book) is DocumentStatus.LINKED


def test_approving_a_section_note_requeues_its_chapter(session, book):
    store(session, book, ArtifactType.SECTION_NOTE, "ch01/s01")
    edited = store(session, book, ArtifactType.SECTION_NOTE, "ch01/s02", Review.APPROVED)

    enqueued = orchestrator.on_review(session, edited)

    assert [(j.kind, j.anchor) for j in enqueued] == [(JobKind.DISTIL_CHAPTER, "ch01")]


def test_approving_an_element_explanation_requeues_its_section(session, book):
    figure = store(session, book, ArtifactType.FIGURE_DESCRIPTION, "ch01/s01/f001", Review.APPROVED)

    enqueued = orchestrator.on_review(session, figure)

    assert [(j.kind, j.anchor) for j in enqueued] == [(JobKind.DISTIL_SECTION, "ch01/s01")]


def test_status_never_moves_backwards(session, make_job):
    doc = add_document(session, status=DocumentStatus.LINKED)
    add_nodes(session, doc, BOOK)

    orchestrator.on_job_done(
        session, finish(session, make_job(JobKind.EXPLAIN_CODE, doc, "ch02/c001"))
    )

    assert status(session, doc) is DocumentStatus.LINKED


@pytest.mark.parametrize(
    ("kind", "meta", "expected"),
    [
        (NodeKind.MATH, {"inline": False}, JobKind.DESCRIBE_MATH),
        (NodeKind.MATH, {"inline": True}, None),
        (NodeKind.TABLE, {"caption": "Table 1", "rows": [[1]] * 6}, None),
        (NodeKind.TABLE, {"caption": "Table 1", "rows": [[1]] * 7}, JobKind.EXPLAIN_TABLE),
        (NodeKind.TABLE, {"rows": [[1]]}, JobKind.EXPLAIN_TABLE),
        (NodeKind.PARAGRAPH, {}, None),
    ],
)
def test_which_elements_get_an_explanation_job(kind, meta, expected):
    node = Node(anchor="ch01/x001", kind=kind, ordinal=0, depth=1, meta=meta)

    assert orchestrator.element_job(node) is expected

"""`reopen`: undo a verdict (approved / rejected → draft) without undoing what it fed."""

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.models import Artifact, Document, Job
from app.models.enums import ArtifactType, DocumentStatus, JobKind, Origin, Review
from tests.conftest import AUTH
from tests.pipeline.runtime.conftest import body, paragraph

API = "/api/v1/artifacts"


def artifact(session: Session, doc: Document, review: Review, **fields: object) -> Artifact:
    row = Artifact(
        document_id=doc.id, anchor="ch02", type=ArtifactType.CHAPTER_DISTILLATION, version=1,
        origin=Origin.SKILL, skill="distil-chapter", skill_version="1", input_hash="same-input",
        body=body(paragraph("Loops seek goals.", "ch02/p001")), review=review,
    )  # fmt: skip
    for name, value in fields.items():
        setattr(row, name, value)
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def reopen(api: TestClient, row: Artifact) -> tuple[int, dict]:
    response = api.post(f"{API}/{row.id}/review", json={"action": "reopen"}, headers=AUTH)
    return response.status_code, response.json()


def queued_kinds(session: Session) -> list[JobKind]:
    return [job.kind for job in session.exec(select(Job))]


def test_reopen_returns_an_approved_artifact_to_draft(api, session, book):
    approved = artifact(session, book, Review.APPROVED)

    status, reopened = reopen(api, approved)

    assert status == 200
    assert (reopened["review"], reopened["reviewed_at"]) == ("draft", None)


def test_only_a_verdict_can_be_reopened(api, session, book):
    status, error = reopen(api, artifact(session, book, Review.NEEDS_REVIEW))

    assert status == 409
    assert error["error"]["code"] == "conflict"


def test_a_rejected_artifact_reopens_unless_its_input_has_a_live_artifact(api, session, book):
    lone = artifact(session, book, Review.REJECTED, input_hash="lone-input")
    rejected = artifact(session, book, Review.REJECTED, version=2)
    artifact(session, book, Review.DRAFT, version=3)  # the re-run that replaced it

    assert reopen(api, lone)[1]["review"] == "draft"
    status, error = reopen(api, rejected)
    assert status == 409
    assert error["error"]["details"][0]["field"] == "input_hash"


def test_reopening_indexed_approved_content_queues_embed_to_withdraw_it(api, session, book):
    book.status = DocumentStatus.INDEXED
    session.add(book)
    session.commit()

    reopen(api, artifact(session, book, Review.APPROVED))

    # the distillation's pills follow its preferred version too (docs/PILLS.md §4)
    assert sorted(queued_kinds(session)) == [JobKind.EMBED, JobKind.HARVEST_PILLS]


def test_reopening_before_indexing_changes_nothing_downstream(api, session, book):
    book.status = DocumentStatus.DISTILLED
    session.add(book)
    session.commit()

    reopen(api, artifact(session, book, Review.APPROVED, type=ArtifactType.BOOK_BRIEF, anchor=None))
    session.refresh(book)

    assert queued_kinds(session) == []
    assert book.status is DocumentStatus.DISTILLED

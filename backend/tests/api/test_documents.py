"""Listing, lookup, edits and deletion of documents."""

from pathlib import Path

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.jobs import queue
from app.jobs.queue import JobSpec
from app.models import Document, Node
from app.models.enums import DocumentStatus, JobKind, NodeKind, Review
from tests.api.factories import (
    make_artifact,
    make_book,
    make_document,
    make_node,
    make_note,
    write_file,
)
from tests.conftest import AUTH

URL = "/api/v1/documents"


def test_list_items_carry_node_note_artifact_and_job_stats(client: TestClient, session: Session):
    book = make_book(session, title="Thinking in Systems")
    make_node(session, book, "t002", NodeKind.TABLE, ordinal=5)  # a leaf, not a figure
    make_note(session, book, "ch01/s01/p001")
    make_artifact(session, book, anchor="ch01", review=Review.APPROVED)
    make_artifact(session, book, anchor="ch01", version=2, review=Review.DRAFT)
    make_artifact(session, book, anchor="ch02", review=Review.DRAFT)
    queue.enqueue(session, JobSpec(kind=JobKind.PARSE, document_id=book.id))
    latest = queue.enqueue(session, JobSpec(kind=JobKind.EXPORT, document_id=book.id))
    make_document(session)  # a second, empty document

    items = client.get(URL).json()["items"]

    stats = {i["slug"]: (i["counts"], i["artifacts"], i["latest_job"]) for i in items}
    counts, artifacts, job = stats[book.slug]
    assert counts == {"chapters": 2, "blocks": 6, "figures": 1, "notes": 1}
    assert artifacts == {"draft": 2, "needs_review": 0, "approved": 1, "rejected": 0}
    assert latest is not None and job["id"] == str(latest.id)
    assert len(items) == 2
    no_counts = {"chapters": 0, "blocks": 0, "figures": 0, "notes": 0}
    no_artifacts = {"draft": 0, "needs_review": 0, "approved": 0, "rejected": 0}
    assert [v for k, v in stats.items() if k != book.slug] == [(no_counts, no_artifacts, None)]


def test_list_filters_by_tag_status_author_and_title(client: TestClient, session: Session):
    make_document(
        session,
        slug="a",
        title="Thinking in Systems",
        tags=["systems"],
        authors=["Donella H. Meadows"],
        status=DocumentStatus.PARSED,
    )
    make_document(session, slug="b", title="Deep Work", tags=["focus"], authors=["Cal Newport"])

    def slugs(**params: str) -> list[str]:
        return [i["slug"] for i in client.get(URL, params=params).json()["items"]]

    assert slugs(tag="systems") == ["a"]
    assert slugs(status="registered") == ["b"]
    assert slugs(author="meadows") == ["a"]
    assert slugs(q="deep") == ["b"]
    assert slugs(q="100%") == []  # LIKE metacharacters match literally


def test_list_is_paginated_with_total(client: TestClient, session: Session):
    for _ in range(3):
        make_document(session)

    page = client.get(URL, params={"limit": 2, "offset": 2}).json()

    assert (page["total"], len(page["items"]), page["limit"], page["offset"]) == (3, 1, 2, 2)


def test_get_by_slug_or_id_returns_pipeline_state(client: TestClient, session: Session):
    book = make_book(session, outline_override=[{"title": "One"}])
    queue.enqueue(session, JobSpec(kind=JobKind.PARSE, document_id=book.id))

    by_slug = client.get(f"{URL}/{book.slug}").json()
    by_id = client.get(f"{URL}/{book.id}").json()

    assert by_slug == by_id
    assert by_slug["jobs"] == {"parse": {"queued": 1}}
    assert by_slug["outline_override"] == [{"title": "One"}]
    assert by_slug["counts"]["chapters"] == 2


def test_unknown_document_is_404(client: TestClient):
    assert client.get(f"{URL}/nope").status_code == 404
    assert client.get(f"{URL}/00000000-0000-0000-0000-000000000000").status_code == 404


def test_patch_edits_metadata_only(client: TestClient, session: Session):
    document = make_document(session)

    response = client.patch(
        f"{URL}/{document.slug}",
        json={
            "title": "  New title ",
            "authors": ["A. Author"],
            "year": 2001,
            "tags": ["x"],
            "language": "de",
        },
        headers=AUTH,
    )

    assert response.status_code == 200
    body = response.json()
    assert (body["title"], body["authors"], body["year"], body["tags"], body["language"]) == (
        "New title",
        ["A. Author"],
        2001,
        ["x"],
        "de",
    )
    assert body["slug"] == document.slug


def test_patch_rejects_other_fields_and_nulls_on_required_ones(
    client: TestClient, session: Session
):
    document = make_document(session)

    slug_edit = client.patch(f"{URL}/{document.slug}", json={"slug": "x"}, headers=AUTH)
    null_title = client.patch(f"{URL}/{document.slug}", json={"title": None}, headers=AUTH)

    assert slug_edit.status_code == 422
    assert null_title.status_code == 422


def test_delete_removes_the_row_and_its_tree_but_keeps_the_file(
    client: TestClient, session: Session, library_dir: Path
):
    write_file(library_dir, "keep.pdf")
    created = client.post(URL, json={"path": "library/keep.pdf"}, headers=AUTH).json()
    slug = created["document"]["slug"]

    response = client.delete(f"{URL}/{slug}", headers=AUTH)

    assert response.status_code == 204
    assert session.exec(select(Document)).all() == []
    assert session.exec(select(Node)).all() == []
    assert (library_dir / "keep.pdf").exists()
    assert client.get(f"{URL}/{slug}").status_code == 404

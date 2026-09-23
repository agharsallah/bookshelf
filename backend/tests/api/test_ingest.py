"""Ingest by library path: containment, dedupe, slugs, the queued parse, the listing."""

import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.models import Job
from app.models.enums import JobKind, JobState
from tests.api.factories import make_document, write_file
from tests.conftest import AUTH

URL = "/api/v1/documents"


def ingest(client: TestClient, **body: object):
    return client.post(URL, json=body, headers=AUTH)


def test_ingest_by_path_registers_the_document_and_queues_a_parse(
    client: TestClient, session: Session, library_dir: Path
):
    write_file(library_dir, "meadows-systems.pdf", b"%PDF-1.7 fake")

    response = ingest(client, path="library/meadows-systems.pdf", tags=["systems", "systems"])

    assert response.status_code == 202
    body = response.json()
    document = body["document"]
    assert document["slug"] == "meadows-systems"
    assert document["title"] == "Meadows Systems"
    assert document["kind"] == "pdf"
    assert document["status"] == "registered"
    assert document["source_path"] == "library/meadows-systems.pdf"
    assert document["tags"] == ["systems"]
    assert body["job"]["kind"] == "parse"
    assert body["job"]["state"] == "queued"
    jobs = session.exec(select(Job)).all()
    assert [(j.kind, j.state, str(j.document_id)) for j in jobs] == [
        (JobKind.PARSE, JobState.QUEUED, document["id"])
    ]


def test_path_relative_to_the_library_and_title_override_are_accepted(
    client: TestClient, library_dir: Path
):
    write_file(library_dir, "articles/essay.html")

    response = ingest(client, path="articles/essay.html", title="On Leverage Points")

    assert response.status_code == 202
    assert response.json()["document"]["slug"] == "on-leverage-points"
    assert response.json()["document"]["kind"] == "article"
    assert response.json()["document"]["source_path"] == "library/articles/essay.html"


@pytest.mark.parametrize(
    "path",
    [
        "library/../outside.pdf",
        "../outside.pdf",
        "/etc/passwd",
        "library/missing.pdf",
        "library/notes.txt",
        "library/sub",
    ],
    ids=["dotdot-in-library", "dotdot", "absolute", "missing", "unsupported-suffix", "directory"],
)
def test_paths_that_are_not_a_supported_library_file_are_rejected(
    client: TestClient, library_dir: Path, path: str
):
    write_file(library_dir.parent, "outside.pdf")
    write_file(library_dir, "notes.txt")
    (library_dir / "sub").mkdir()

    response = ingest(client, path=path)

    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["field"] == "body.path"


def test_symlink_escaping_the_library_is_rejected(client: TestClient, library_dir: Path):
    outside = write_file(library_dir.parent / "elsewhere", "secret.pdf")
    os.symlink(outside, library_dir / "link.pdf")

    response = ingest(client, path="library/link.pdf")

    assert response.status_code == 422
    assert "escapes" in response.json()["error"]["message"]


def test_same_content_twice_is_409_with_the_existing_document(
    client: TestClient, library_dir: Path
):
    write_file(library_dir, "a.pdf", b"same bytes")
    write_file(library_dir, "copy-of-a.pdf", b"same bytes")
    first = ingest(client, path="library/a.pdf").json()["document"]

    response = ingest(client, path="library/copy-of-a.pdf")

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "conflict"
    assert response.json()["error"]["details"] == [
        {"document_id": first["id"], "slug": first["slug"]}
    ]


def test_slugs_get_a_numeric_suffix_when_taken(
    client: TestClient, session: Session, library_dir: Path
):
    make_document(session, slug="thinking")
    make_document(session, slug="thinking-2")
    write_file(library_dir, "thinking.pdf")

    response = ingest(client, path="library/thinking.pdf")

    assert response.json()["document"]["slug"] == "thinking-3"


def test_source_must_be_exactly_one_of_path_or_url(client: TestClient):
    both = ingest(client, path="library/a.pdf", url="https://example.com/")
    neither = ingest(client, title="Nothing")

    assert both.status_code == 422
    assert neither.status_code == 422


def test_library_lists_only_supported_files_not_yet_ingested(client: TestClient, library_dir: Path):
    write_file(library_dir, "done.pdf")
    write_file(library_dir, "Deep/Work Notes.md")
    write_file(library_dir, "ignore.txt")
    write_file(library_dir, ".hidden/secret.pdf")
    ingest(client, path="library/done.pdf")

    listing = client.get("/api/v1/library").json()

    assert listing["total"] == 1
    [item] = listing["items"]
    assert item["path"] == "library/Deep/Work Notes.md"
    assert item["kind"] == "article"
    assert item["suggested_slug"] == "work-notes"
    assert item["suggested_title"] == "Work Notes"
    assert item["size"] == 128

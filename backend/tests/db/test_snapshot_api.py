"""`/database/snapshot`: make a snapshot here, download it, restore it on another install.

"Another install" is the peer database with folders of its own: the snapshot is made from
the test database, then the app is pointed at the peer and the download restored there.
"""

from collections.abc import Iterator
from pathlib import Path
from typing import cast

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.routes.snapshots import get_snapshot_service
from app.core.config import Environment, Settings, get_settings
from app.db import session as db_session
from app.db.targets import DatabaseTarget
from app.models import Document, Job
from app.models.enums import JobKind, JobState
from app.services.snapshots import SnapshotService
from tests.api.factories import make_document
from tests.conftest import AUTH


class FakeRunners:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def stop(self) -> None:
        self.calls.append("stop")

    def start(self) -> None:
        self.calls.append("start")


def folders(base: Path) -> dict[str, Path]:
    return {"library_dir": base / "library", "media_dir": base / "media",
            "audio_dir": base / "audio", "snapshots_dir": base / "snapshots"}  # fmt: skip


@pytest.fixture
def settings(peer_url: str, tmp_path: Path) -> Settings:
    return get_settings().model_copy(
        update={"environment": Environment.LOCAL, "local_database_url": peer_url,
                "database_backups_dir": tmp_path / "backups", **folders(tmp_path / "here")}
    )  # fmt: skip


@pytest.fixture
def runners() -> FakeRunners:
    return FakeRunners()


@pytest.fixture
def service(
    client: TestClient, settings: Settings, runners: FakeRunners
) -> Iterator[SnapshotService]:
    service = SnapshotService(settings, runners=lambda: runners)  # type: ignore[arg-type, return-value]
    app = cast(FastAPI, client.app)
    app.dependency_overrides[get_snapshot_service] = lambda: service
    yield service
    app.dependency_overrides.pop(get_snapshot_service)
    db_session.use_target(DatabaseTarget.REMOTE, get_settings().database_url)


def move_to_the_other_install(service: SnapshotService, base: Path) -> None:
    """Point the app at the peer database, with folders of its own."""
    service.settings = service.settings.model_copy(update=folders(base))
    db_session.use_target(DatabaseTarget.LOCAL, service.settings.local_database_url)


def test_every_change_needs_the_api_key(client):
    assert client.post("/api/v1/database/snapshot").status_code == 401
    assert client.post("/api/v1/database/snapshot/download").status_code == 401
    assert client.post("/api/v1/database/snapshot/restore", content=b"x").status_code == 401


def test_with_nothing_made_there_is_nothing_to_download(client, service):
    assert client.get("/api/v1/database/snapshot").json()["latest"] is None
    assert client.post("/api/v1/database/snapshot/download", headers=AUTH).status_code == 404


def test_make_download_and_restore_elsewhere(client, service, session, runners, tmp_path):
    make_document(session, title="Thinking in Systems", source_path="library/systems.pdf")
    here = service.settings
    (here.library_dir / "systems.pdf").parent.mkdir(parents=True)
    (here.library_dir / "systems.pdf").write_bytes(b"%PDF original")
    (here.audio_dir / "x" / "brief").mkdir(parents=True)
    (here.audio_dir / "x" / "brief" / "k.mp3").write_bytes(b"ID3")

    started = client.post("/api/v1/database/snapshot", headers=AUTH)
    assert started.status_code == 202 and started.json()["action"] == "export"
    assert service.wait(timeout=30).state == "done"
    latest = client.get("/api/v1/database/snapshot").json()["latest"]
    assert latest["documents"] == 1 and latest["files"] == 2
    download = client.post("/api/v1/database/snapshot/download", headers=AUTH)
    assert download.status_code == 200
    assert download.headers["content-disposition"].endswith(f'filename="{latest["name"]}"')

    there = tmp_path / "there"
    move_to_the_other_install(service, there)
    (there / "library").mkdir(parents=True)
    (there / "library" / "only-there.pdf").write_bytes(b"replaced")
    restored = client.post(
        "/api/v1/database/snapshot/restore", params={"backup": False}, content=download.content,
        headers={**AUTH, "content-type": "application/gzip"},
    )  # fmt: skip
    assert restored.status_code == 202 and restored.json()["action"] == "restore"
    finished = service.wait(timeout=30)

    assert finished.state == "done", finished.error
    with Session(db_session.get_engine()) as peer:
        assert [d.title for d in peer.exec(select(Document))] == ["Thinking in Systems"]
        embed = peer.get(Job, finished.reindex_job)
        assert embed is not None and embed.kind == JobKind.EMBED and embed.document_id is None
    assert (there / "library" / "systems.pdf").read_bytes() == b"%PDF original"
    assert (there / "audio" / "x" / "brief" / "k.mp3").read_bytes() == b"ID3"
    assert not (there / "library" / "only-there.pdf").exists()
    assert Path(finished.kept_path or "", "library", "only-there.pdf").exists()
    assert runners.calls == ["stop", "start"]  # nothing wrote while the rows were replaced
    assert list((there / "snapshots").glob("upload-*")) == []  # working files cleaned up


def test_a_restore_hands_back_jobs_the_snapshot_caught_running(client, service, session):
    document = make_document(session)
    session.add(Job(kind=JobKind.PARSE, document_id=document.id, state=JobState.RUNNING))
    session.commit()
    service.start_export()
    assert service.wait(timeout=30).state == "done"
    upload = service.download().read_bytes()
    session.exec(select(Job)).one().state = JobState.DONE  # the job finished here meanwhile
    session.commit()

    move_to_the_other_install(service, service.settings.snapshots_dir.parent / "there")
    response = client.post("/api/v1/database/snapshot/restore", params={"backup": False},
                           content=upload, headers=AUTH)  # fmt: skip
    assert response.status_code == 202
    assert service.wait(timeout=30).state == "done"

    with Session(db_session.get_engine()) as peer:
        parse = peer.exec(select(Job).where(Job.kind == JobKind.PARSE)).one()
        assert parse.state == JobState.QUEUED


def test_a_restore_is_refused_before_the_upload_while_a_job_runs(client, service, session):
    session.add(Job(kind=JobKind.PARSE, document_id=make_document(session).id,
                    state=JobState.RUNNING))  # fmt: skip
    session.commit()

    response = client.post("/api/v1/database/snapshot/restore", params={"backup": False},
                           content=b"never read", headers=AUTH)  # fmt: skip

    assert response.status_code == 409 and "running" in response.json()["error"]["message"]
    assert service.exclusive.holder is None  # let go, so the next try can run
    assert list(service.settings.snapshots_dir.glob("upload-*")) == []


def test_a_file_that_is_not_a_snapshot_fails_and_changes_nothing(client, service, session):
    make_document(session, title="Kept")

    response = client.post("/api/v1/database/snapshot/restore", params={"backup": False},
                           content=b"not a snapshot", headers=AUTH)  # fmt: skip
    finished = service.wait(timeout=30)

    assert response.status_code == 202
    assert finished.state == "failed" and "cannot be unpacked" in (finished.error or "")
    assert [d.title for d in session.exec(select(Document))] == ["Kept"]
    assert service.exclusive.holder is None


def test_one_operation_at_a_time(client, service):
    service.exclusive.claim("A sync")
    try:
        response = client.post("/api/v1/database/snapshot", headers=AUTH)
    finally:
        service.exclusive.release()

    assert response.status_code == 409
    assert response.json()["error"]["message"] == "A sync is running; wait for it to finish."


def test_an_upload_may_be_larger_than_any_other_request(client, service):
    too_big_elsewhere = b"\0" * (get_settings().max_request_bytes + 1)

    response = client.post("/api/v1/database/snapshot/restore", params={"backup": False},
                           content=too_big_elsewhere, headers=AUTH)  # fmt: skip

    assert response.status_code == 202  # streamed to disk; unpacking it then fails
    assert service.wait(timeout=30).state == "failed"

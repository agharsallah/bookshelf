"""Settings → Database: switching which database the app uses, and syncing in the background.

"This computer" is the peer database here and the "main" one is the test database, so
the service sees two databases without either being real.
"""

from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlmodel import Session, select

from app.core.config import Environment, Settings, get_settings
from app.core.errors import ConflictError
from app.db import session as db_session
from app.db.targets import DatabaseTarget, stored_target
from app.models import Document, Job
from app.models.enums import JobKind, JobState
from app.services.database import DatabaseService
from tests.api.factories import make_document

LOCAL, REMOTE = DatabaseTarget.LOCAL, DatabaseTarget.REMOTE


class FakeRunners:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def stop(self) -> None:
        self.calls.append("stop")

    def start(self) -> None:
        self.calls.append("start")


@pytest.fixture
def settings(peer_url: str, tmp_path: Path) -> Settings:
    return get_settings().model_copy(
        update={
            "environment": Environment.LOCAL,
            "local_database_url": peer_url,
            "database_target_file": tmp_path / "database-target",
            "database_backups_dir": tmp_path / "backups",
        }
    )


@pytest.fixture
def runners() -> FakeRunners:
    return FakeRunners()


@pytest.fixture
def service(settings: Settings, runners: FakeRunners, peer) -> Iterator[DatabaseService]:
    yield DatabaseService(settings, lambda: runners)  # type: ignore[arg-type, return-value]
    db_session.use_target(REMOTE, get_settings().database_url)  # back to the test database


def test_status_compares_both_databases(service, session):
    make_document(session)

    status = service.status()

    assert status.available and status.active is REMOTE
    by_target = {t.target: t for t in status.targets}
    assert by_target[REMOTE].active and not by_target[LOCAL].active
    assert by_target[REMOTE].counts.documents == 1
    assert by_target[LOCAL].counts.documents == 0
    assert by_target[LOCAL].label == "This computer"
    assert "@" not in by_target[REMOTE].host  # never the user or password
    assert status.schema_problems == []
    assert status.sync.state == "idle"


def test_an_unreachable_database_is_reported_not_raised(settings, peer):
    broken = settings.model_copy(
        update={"local_database_url": "postgresql+psycopg://x@127.0.0.1:1/nowhere"}
    )

    status = DatabaseService(broken).status()

    local = next(t for t in status.targets if t.target is LOCAL)
    assert not local.reachable and local.error and local.counts is None


def test_a_self_hosted_main_database_is_migrated_before_a_switch(settings, runners, bare_url):
    """A main database on a Postgres server (a VM, say) gets the schema from here."""
    service = DatabaseService(settings.model_copy(update={"database_url": bare_url}),
                              lambda: runners)  # type: ignore[arg-type, return-value]  # fmt: skip
    try:
        before = {t.target: t for t in service.status().targets}
        assert before[REMOTE].pending_migrations > 0 and before[REMOTE].counts is None

        service.switch(LOCAL)

        after = {t.target: t for t in service.status().targets}
        assert after[REMOTE].pending_migrations == 0
        assert after[REMOTE].counts is not None and after[REMOTE].counts.documents == 0
    finally:
        db_session.use_target(REMOTE, get_settings().database_url)


def test_with_one_database_there_is_nothing_to_switch_or_sync():
    service = DatabaseService(get_settings())  # tests: one database

    assert not service.status().available
    with pytest.raises(ConflictError):
        service.switch(LOCAL)
    with pytest.raises(ConflictError):
        service.start_sync(LOCAL, backup=False)


def test_switching_points_new_sessions_at_the_other_database(service, settings, runners, session):
    make_document(session, title="On the main database")

    status = service.switch(LOCAL)

    assert status.active is LOCAL and db_session.active_target() is LOCAL
    assert stored_target(settings) is LOCAL  # kept across restarts
    assert runners.calls == ["stop", "start"]  # running jobs handed back first
    with Session(db_session.get_engine()) as other:
        assert other.exec(select(Document)).all() == []


def test_switching_to_the_active_database_changes_nothing(service, runners):
    service.switch(REMOTE)

    assert runners.calls == []


def test_a_sync_copies_in_the_background_and_reports_progress(service, session, peer):
    make_document(session, title="Thinking in Systems")

    started = service.start_sync(REMOTE, backup=False)
    finished = service.wait(timeout=30)

    assert (started.state, started.source, started.dest) == ("running", REMOTE, LOCAL)
    assert finished.state == "done", finished.error
    assert finished.tables_done == finished.tables_total > 0 and finished.rows >= 1
    assert [row[0] for row in peer.execute("select title from documents")] == [
        "Thinking in Systems"
    ]
    assert service.status().sync.state == "done"


def test_a_sync_into_the_active_database_pauses_the_runners(service, runners, session):
    make_document(session)
    service.switch(LOCAL)
    runners.calls.clear()

    service.start_sync(REMOTE, backup=False)
    assert service.wait(timeout=30).state == "done"

    assert runners.calls == ["stop", "start"]


def test_a_sync_out_of_the_active_database_leaves_the_runners_alone(service, runners):
    service.start_sync(REMOTE, backup=False)
    service.wait(timeout=30)

    assert runners.calls == []


def test_a_sync_waits_for_running_jobs(service, session, peer):
    document = make_document(session)
    session.add(Job(kind=JobKind.PARSE, document_id=document.id, state=JobState.RUNNING))
    session.commit()

    with pytest.raises(ConflictError, match="1 job"):
        service.start_sync(REMOTE, backup=False)

    assert service.status().sync.state == "idle"  # nothing started


def test_a_sync_with_a_backup_dumps_the_destination_first(service, settings):
    if not service.status().can_back_up:
        pytest.skip("pg_dump is not installed")

    service.start_sync(REMOTE, backup=True)
    done = service.wait(timeout=60)

    assert done.state == "done", done.error
    assert done.backup_path and Path(done.backup_path).parent == settings.database_backups_dir
    assert Path(done.backup_path).name.startswith("local-")


def test_a_failed_sync_says_why(service, monkeypatch):
    def lost(*args, **kwargs):
        raise RuntimeError("server closed the connection unexpectedly")

    monkeypatch.setattr("app.db.sync.copy_all", lost)

    service.start_sync(REMOTE, backup=False)
    done = service.wait(timeout=30)

    assert (done.state, done.error) == ("failed", "server closed the connection unexpectedly")

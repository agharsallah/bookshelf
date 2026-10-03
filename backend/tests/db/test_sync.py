"""Copying one database over another: an exact mirror, all or nothing."""

from datetime import UTC, datetime

import psycopg
import pytest
from sqlmodel import Session

from app.db import sync
from app.models import ActivityMinute
from app.models.enums import NoteTarget, Surface
from tests.api.factories import make_artifact, make_document, make_note


def count(conn: psycopg.Connection, table: str) -> int:
    row = conn.execute(f"select count(*) from {table}").fetchone()  # noqa: S608  (test names)
    return int(row[0]) if row else 0


def insert_document(conn: psycopg.Connection, slug: str, title: str) -> None:
    conn.execute(
        "insert into documents (kind, slug, title, sha256, source_path) "
        "values ('pdf', %s, %s, md5(%s) || md5(%s), 'library/' || %s || '.pdf')",
        (slug, title, slug, title, slug),
    )


def seed_cycle(session: Session) -> None:
    """A note on an artifact, and an artifact made from that note: `notes` ↔ `artifacts`."""
    document = make_document(session, title="Thinking in Systems")
    summary = make_artifact(session, document)
    note = make_note(
        session, document, "ch01/p001", target=NoteTarget.CHAPTER_SUMMARY, artifact_id=summary.id,
        block=0, range={"start": 0, "end": 4}, quote="text",
    )  # fmt: skip
    make_artifact(session, document, version=2, note_id=note.id)


def test_the_destination_becomes_an_exact_copy_of_the_source(session, main_db, peer):
    seed_cycle(session)
    insert_document(peer, "only-there", "Only on the peer")

    copied = sync.copy_all(main_db, peer)

    assert copied["documents"] == 1 and copied["notes"] == 1 and copied["artifacts"] == 2
    titles = [row[0] for row in peer.execute("select title from documents")]
    assert titles == ["Thinking in Systems"]
    assert count(peer, "notes") == 1 and count(peer, "artifacts") == 2
    # Generated columns are computed again on the destination, not copied.
    assert sync.tables(peer)["nodes"] == sync.tables(main_db)["nodes"]


def test_foreign_keys_are_back_to_not_deferrable_afterwards(session, main_db, peer):
    seed_cycle(session)
    before = sync._foreign_keys(peer)

    sync.copy_all(main_db, peer)

    assert before and sync._foreign_keys(peer) == before


def test_identity_sequences_move_past_the_copied_ids(session, main_db, peer):
    document = make_document(session)
    for at in range(3):
        minute = datetime(2026, 10, 1, 9, at, tzinfo=UTC)
        session.add(ActivityMinute(minute=minute, surface=Surface.READ,
                                   document_id=document.id, seconds=60))  # fmt: skip
    session.commit()

    sync.copy_all(main_db, peer)

    peer.execute(
        "insert into activity_minutes (minute, surface, seconds) "
        "values (date_trunc('minute', now()), 'read', 1)"
    )  # would collide with a copied id if the sequence had not moved
    assert count(peer, "activity_minutes") == 4


def test_a_failure_halfway_leaves_the_destination_as_it_was(session, main_db, peer):
    sync.copy_all(main_db, peer)  # both empty
    insert_document(peer, "kept", "Kept")
    make_document(session)

    def boom(table: str, index: int, total: int) -> None:
        if table == "notes":
            raise RuntimeError("connection lost")

    with pytest.raises(RuntimeError):
        sync.copy_all(main_db, peer, boom)

    assert [row[0] for row in peer.execute("select slug from documents")] == ["kept"]


def test_different_schemas_are_refused_before_anything_is_written(main_db, peer):
    insert_document(peer, "kept", "Kept")
    peer.execute("alter table collections add column sync_test_extra text")
    try:
        with pytest.raises(ValueError, match=r"sync_test_extra is missing on the source"):
            sync.copy_all(main_db, peer)
    finally:
        peer.execute("alter table collections drop column sync_test_extra")
    assert count(peer, "documents") == 1


def test_schema_diff_names_every_mismatch():
    here = {"a": (("id", "uuid"), ("x", "text")), "b": (("id", "uuid"),)}
    there = {"a": (("id", "uuid"), ("x", "integer"), ("y", "text")), "c": (("id", "uuid"),)}

    assert sync.schema_diff(here, there) == [
        "table b is missing on the destination",
        "table c is missing on the source",
        "column a.y is missing on the source",
        "column a.x is text here, integer there",
    ]


def test_bookkeeping_tables_are_never_copied(main_db):
    names = sync.tables(main_db)

    assert "workers" not in names and "_local_migrations" not in names
    assert "documents" in names


@pytest.mark.skipif(not sync.can_back_up(), reason="pg_dump is not installed")
def test_a_backup_is_a_restorable_dump(session, main_db, peer, peer_url, tmp_path):
    make_document(session)
    sync.copy_all(main_db, peer)

    path = sync.back_up(peer_url, tmp_path / "peer.dump")

    assert path.stat().st_size > 0
    assert path.read_bytes().startswith(b"PGDMP")  # pg_dump's custom format


def test_a_failed_backup_says_why_and_leaves_no_file(tmp_path):
    if not sync.can_back_up():
        pytest.skip("pg_dump is not installed")
    url = "postgresql+psycopg://nobody@127.0.0.1:1/nowhere"

    with pytest.raises(RuntimeError) as failure:
        sync.back_up(url, tmp_path / "x.dump", timeout=20)

    assert str(failure.value)
    assert not (tmp_path / "x.dump").exists()

"""A snapshot file: rows and folders out of one install, into another, exactly as they were."""

import io
import json
import tarfile
from pathlib import Path

import psycopg
import pytest
from psycopg import sql

from app.db import snapshot
from app.db.snapshot import SnapshotError
from app.db.sync import tables
from tests.api.factories import make_document
from tests.db.test_sync import insert_document, seed_cycle


def fingerprint(conn: psycopg.Connection) -> dict[str, str | None]:
    """Every table's rows, as text, in one hash per table: equal means identical content.
    Text is rendered with the snapshot's own settings, so two sessions render it alike."""
    for setting in snapshot.COPY_SETTINGS:
        conn.execute(f"set {setting}")
    query = "select md5(string_agg(t::text, '|' order by t::text)) from {} t"
    return {
        name: conn.execute(sql.SQL(query).format(sql.Identifier(name))).fetchone()[0]  # type: ignore[index]
        for name in sorted(tables(conn))
    }


def make_roots(base: Path, files: dict[str, bytes]) -> dict[str, Path]:
    roots = {name: base / name for name in snapshot.ROOTS}
    for rel, data in files.items():
        path = base / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    return roots


def tar_of(members: dict[str, bytes]) -> bytes:
    out = io.BytesIO()
    with tarfile.open(fileobj=out, mode="w:gz") as tar:
        for name, data in members.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    return out.getvalue()


def manifest_bytes(**changes: object) -> bytes:
    body = {"format": snapshot.FORMAT, "version": snapshot.VERSION,
            "created_at": "2026-10-16T09:00:00+00:00", "tables": {}} | changes  # fmt: skip
    return json.dumps(body).encode()


def test_rows_and_folders_come_back_exactly(session, main_db, peer, tmp_path):
    seed_cycle(session)  # jsonb, arrays, timestamps, a notes ↔ artifacts cycle
    insert_document(peer, "only-there", "Only on the peer")
    source = make_roots(tmp_path / "here", {
        "library/papers/attention.pdf": b"%PDF-1.7 originals",
        "media/attention/fig-1.png": b"\x89PNG crops",
        "audio/doc-id/brief/key.mp3": b"ID3 narration",
        "media/.DS_Store": b"finder litter",
    })  # fmt: skip
    dest = make_roots(tmp_path / "there", {"library/stale.pdf": b"replaced"})
    archive = tmp_path / "out" / "shelf.tar.gz"
    archive.parent.mkdir()

    manifest = snapshot.write(main_db, source, archive)
    unpacked = snapshot.unpack(archive, tmp_path / "unpacked")
    copied = snapshot.load(peer, tmp_path / "unpacked", unpacked)
    snapshot.swap_in(tmp_path / "unpacked", dest, tmp_path / "kept")

    assert fingerprint(peer) == fingerprint(main_db)
    assert copied["documents"] == manifest.rows["documents"] == 1
    assert unpacked.tables == manifest.tables
    assert manifest.files == {"library": 1, "media": 1, "audio": 1}  # .DS_Store left out
    assert (dest["library"] / "papers/attention.pdf").read_bytes() == b"%PDF-1.7 originals"
    assert (dest["audio"] / "doc-id/brief/key.mp3").read_bytes() == b"ID3 narration"
    assert not (dest["library"] / "stale.pdf").exists()
    assert (tmp_path / "kept/library/stale.pdf").read_bytes() == b"replaced"  # kept, not lost


def test_text_values_survive_server_settings(session, main_db, peer, tmp_path):
    make_document(session, title="Ünïcode — “quotes”\ttabs\nand lines")
    main_db.execute("set timezone = 'Pacific/Chatham'")  # neither side's settings leak in
    peer.execute("set datestyle = 'SQL, DMY'")
    archive = tmp_path / "shelf.tar.gz"

    manifest = snapshot.write(main_db, {}, archive)
    snapshot.load(peer, tmp_path / "x", snapshot.unpack(archive, tmp_path / "x"))

    assert manifest.rows["documents"] == 1
    assert fingerprint(peer)["documents"] == fingerprint(main_db)["documents"]


def test_the_manifest_reads_without_unpacking(main_db, tmp_path):
    archive = tmp_path / "shelf.tar.gz"
    snapshot.write(main_db, {}, archive)

    assert set(snapshot.read_manifest(archive).tables) == set(tables(main_db))


def test_a_different_schema_is_refused_before_anything_is_written(main_db, peer, tmp_path):
    archive = tmp_path / "shelf.tar.gz"
    snapshot.write(main_db, {}, archive)
    manifest = snapshot.unpack(archive, tmp_path / "x")
    insert_document(peer, "kept", "Kept")
    peer.execute("alter table collections add column snapshot_test_extra text")
    try:
        with pytest.raises(SnapshotError, match=r"snapshot_test_extra is missing on the source"):
            snapshot.load(peer, tmp_path / "x", manifest)
    finally:
        peer.execute("alter table collections drop column snapshot_test_extra")
    assert [row[0] for row in peer.execute("select slug from documents")] == ["kept"]


@pytest.mark.parametrize(
    ("content", "message"),
    [
        (b"not even gzip", "cannot be"),
        (tar_of({"readme.txt": b"hello"}), "not a Bookshelf snapshot"),
        (tar_of({"manifest.json": manifest_bytes(format="other")}), "not a Bookshelf snapshot"),
        (tar_of({"manifest.json": manifest_bytes(version=99)}), "newer version"),
        (tar_of({"manifest.json": b"{"}), "manifest cannot be read"),
        (
            tar_of({"manifest.json": manifest_bytes(tables={"documents": [["id", "uuid"]]})}),
            "incomplete: no rows for documents",
        ),
    ],
)
def test_what_is_not_a_snapshot_is_refused(tmp_path, content, message):
    archive = tmp_path / "upload.tar.gz"
    archive.write_bytes(content)

    with pytest.raises(SnapshotError, match=message):
        snapshot.unpack(archive, tmp_path / "x")


def test_unpacking_keeps_to_what_a_snapshot_holds(tmp_path):
    archive = tmp_path / "upload.tar.gz"
    archive.write_bytes(tar_of({
        "manifest.json": manifest_bytes(tables={"documents": [["id", "uuid"]]}),
        "database/documents.copy": b"",
        "database/intruder.copy": b"",  # a table the manifest does not name
        "files/library/a.pdf": b"pdf",
        "files/elsewhere/b.txt": b"not a root",
        "files/library/../../escape.txt": b"climbs out",
        "/etc/absolute.txt": b"absolute",
    }))  # fmt: skip

    snapshot.unpack(archive, tmp_path / "x")

    found = sorted(p.relative_to(tmp_path).as_posix() for p in tmp_path.rglob("*") if p.is_file())
    assert found == ["upload.tar.gz", "x/database/documents.copy", "x/files/library/a.pdf"]

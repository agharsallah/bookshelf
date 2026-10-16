"""A snapshot: the whole shelf in one file, to carry it to another install (Settings → Database).

    bookshelf-<stamp>-<token>.tar.gz
      manifest.json             what it is: format, when, each table's columns and rows
      database/<table>.copy     each table's rows, in COPY text format
      files/library/…           the originals
      files/media/…             figure crops, rendered pages
      files/audio/…             narrations and voices

The rows are read in one repeatable-read snapshot. They are written as COPY *text* (a sync
uses binary), which any Postgres version reads back, with the session settings that shape
text output (time zone, date style…) fixed, so a value reads back as it was written.

Restoring is the reverse, and all or nothing for the rows: the archive is unpacked into a
folder of its own and its manifest checked against this database's schema; then the rows
are replaced in one transaction (`sync.replace_rows`), and only after it commits are the
unpacked folders moved in place of the current ones, which are kept (`swap_in`).

The search index is not in it: Qdrant is derived (D1), and an `embed` rebuild after a
restore brings it back from the rows.
"""

import gzip
import io
import json
import re
import shutil
import tarfile
import zlib
from collections.abc import Callable, Iterator, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath

import psycopg

from app.db.sync import Columns, copy_out, replace_rows, schema_diff, tables

FORMAT = "bookshelf-snapshot"
VERSION = 1
MANIFEST = "manifest.json"
SUFFIX = ".tar.gz"
ROOTS = ("library", "media", "audio")  # the folders a snapshot carries, by archive name
SKIPPED_NAMES = frozenset({".DS_Store"})
# Most of the bytes are PDFs, images and mp3s, already compressed: a light pass is enough
# for the rows and is several times faster than gzip's default.
COMPRESS_LEVEL = 1
# Text output that reads back the same on any server: UTC, ISO dates, exact floats.
COPY_SETTINGS = (
    "timezone = 'UTC'",
    "datestyle = 'ISO, YMD'",
    "intervalstyle = 'postgres'",
    "extra_float_digits = 3",
    "bytea_output = 'hex'",
)
_TABLE_FILE = re.compile(r"database/([a-z_][a-z0-9_]*)\.copy")

OnStep = Callable[[str, int, int], None]  # what is happening, items done, items in all


class SnapshotError(ValueError):
    """The file is not a snapshot this install can restore; the message says why."""


@dataclass(frozen=True)
class Manifest:
    created_at: datetime
    tables: dict[str, Columns]
    rows: dict[str, int] = field(default_factory=dict)
    files: dict[str, int] = field(default_factory=dict)  # per root
    file_bytes: int = 0

    def to_json(self) -> bytes:
        body = {
            "format": FORMAT,
            "version": VERSION,
            "created_at": self.created_at.isoformat(),
            "tables": {name: [list(col) for col in cols] for name, cols in self.tables.items()},
            "rows": self.rows,
            "files": self.files,
            "file_bytes": self.file_bytes,
        }
        return json.dumps(body, indent=2, sort_keys=True).encode()

    @classmethod
    def from_json(cls, raw: bytes) -> "Manifest":
        try:
            body = json.loads(raw)
            if body.get("format") != FORMAT:
                raise SnapshotError("This is not a Bookshelf snapshot.")
            if not isinstance(body.get("version"), int) or body["version"] > VERSION:
                raise SnapshotError(
                    "This snapshot was made by a newer version of Bookshelf; update this one."
                )
            return cls(
                created_at=datetime.fromisoformat(body["created_at"]),
                tables={
                    str(name): tuple((str(col), str(typ)) for col, typ in cols)
                    for name, cols in body["tables"].items()
                },
                rows={str(k): int(v) for k, v in body.get("rows", {}).items()},
                files={str(k): int(v) for k, v in body.get("files", {}).items()},
                file_bytes=int(body.get("file_bytes", 0)),
            )
        except SnapshotError:
            raise
        except (ValueError, KeyError, TypeError, AttributeError) as exc:
            raise SnapshotError("The snapshot's manifest cannot be read.") from exc


def _files(root: Path) -> Iterator[tuple[PurePosixPath, int]]:
    """Every regular file under `root` (relative to it) and its size, in a stable order."""
    if not root.is_dir():
        return
    for path in sorted(root.rglob("*")):
        if path.is_file() and not path.is_symlink() and path.name not in SKIPPED_NAMES:
            yield PurePosixPath(path.relative_to(root).as_posix()), path.stat().st_size


def _apply_copy_settings(conn: psycopg.Connection, *, local: bool) -> None:
    for setting in COPY_SETTINGS:
        conn.execute(f"set {'local ' if local else ''}{setting}")


# -- writing ------------------------------------------------------------------------------


def write(
    conn: psycopg.Connection,
    roots: Mapping[str, Path],
    path: Path,
    on_step: OnStep | None = None,
) -> Manifest:
    """Write a snapshot of `conn`'s rows and the `roots` folders to `path`.

    `conn` must be in autocommit mode. The archive appears at `path` only once complete.
    """
    names = tables(conn)
    found = {root: list(_files(folder)) for root, folder in roots.items()}
    total = len(names) + sum(map(len, found.values()))
    done = 0

    def step(text: str) -> None:
        if on_step is not None:
            on_step(text, done, total)

    parts = path.with_name(f"{path.name}.parts")
    partial = path.with_name(f"{path.name}.partial")
    shutil.rmtree(parts, ignore_errors=True)
    parts.mkdir(parents=True)
    try:
        rows: dict[str, int] = {}
        with conn.transaction():
            conn.execute("set transaction isolation level repeatable read, read only")
            conn.execute("set local statement_timeout = 0")
            _apply_copy_settings(conn, local=True)
            for name in sorted(names):
                step(f"Reading {name}")
                query = copy_out(conn, name, names[name], "text")
                with (
                    (parts / f"{name}.copy").open("wb") as out,
                    conn.cursor() as cur,
                    cur.copy(query) as copy,
                ):
                    count = 0
                    for chunk in copy:
                        out.write(chunk)
                        count += bytes(chunk).count(b"\n")  # one line per row in text format
                rows[name] = count
                done += 1

        manifest = Manifest(
            created_at=datetime.now(UTC),
            tables=names,
            rows=rows,
            files={root: len(entries) for root, entries in found.items()},
            file_bytes=sum(size for entries in found.values() for _, size in entries),
        )
        with tarfile.open(partial, "w:gz", compresslevel=COMPRESS_LEVEL) as tar:
            data = manifest.to_json()
            info = tarfile.TarInfo(MANIFEST)  # first, so a restore can refuse a wrong file early
            info.size, info.mtime = len(data), int(manifest.created_at.timestamp())
            tar.addfile(info, io.BytesIO(data))
            for name in sorted(names):
                tar.add(parts / f"{name}.copy", arcname=f"database/{name}.copy", recursive=False)
            for root, entries in found.items():
                for rel, _ in entries:
                    step(f"Packing {root}/{rel}")
                    source = roots[root] / rel
                    if source.is_file():  # removed since it was listed: nothing to carry
                        tar.add(source, arcname=f"files/{root}/{rel}", recursive=False)
                    done += 1
        partial.replace(path)
        return manifest
    finally:
        shutil.rmtree(parts, ignore_errors=True)
        partial.unlink(missing_ok=True)


# -- restoring ----------------------------------------------------------------------------


def _member_kind(member: tarfile.TarInfo, manifest: Manifest) -> str | None:
    """`table` or `file` for a member a snapshot may hold, None for anything else."""
    if not (member.isfile() or member.isdir()):
        return None
    name = PurePosixPath(member.name)
    if name.is_absolute() or ".." in name.parts:
        return None
    match = _TABLE_FILE.fullmatch(member.name)
    if match and member.isfile() and match.group(1) in manifest.tables:
        return "table"
    if len(name.parts) >= 3 and name.parts[0] == "files" and name.parts[1] in ROOTS:
        return "file"
    return None


def _first_manifest(tar: tarfile.TarFile) -> Manifest:
    first = tar.next()
    raw = tar.extractfile(first) if first is not None and first.name == MANIFEST else None
    if raw is None:
        raise SnapshotError("This is not a Bookshelf snapshot.")
    return Manifest.from_json(raw.read())


_UNREADABLE = (tarfile.TarError, EOFError, gzip.BadGzipFile, zlib.error)


def read_manifest(archive: Path) -> Manifest:
    """The manifest alone (it comes first, so nothing else is read)."""
    try:
        with tarfile.open(archive, "r|gz") as tar:
            return _first_manifest(tar)
    except _UNREADABLE as exc:
        raise SnapshotError(f"The snapshot cannot be read: {exc}") from exc


def unpack(archive: Path, into: Path, on_step: OnStep | None = None) -> Manifest:
    """Unpack a snapshot into the empty folder `into` and return its manifest.

    Reads the archive as a stream, manifest first. Raises `SnapshotError` when it is not a
    snapshot, or one with a table missing. Members it does not expect are skipped, and
    every path is held inside `into` (tarfile's `data` filter).
    """
    into.mkdir(parents=True, exist_ok=True)
    try:
        with tarfile.open(archive, "r|gz") as tar:
            manifest = _first_manifest(tar)
            total = len(manifest.tables) + sum(manifest.files.values())
            done = 0
            seen: set[str] = set()  # tables whose rows were found
            while (member := tar.next()) is not None:
                kind = _member_kind(member, manifest)
                if kind is None:
                    continue
                if member.isfile():
                    if on_step is not None:
                        on_step(f"Unpacking {member.name.removeprefix('files/')}", done, total)
                    done += 1
                if kind == "table":
                    seen.add(PurePosixPath(member.name).stem)
                tar.extract(member, into, filter="data")
    except _UNREADABLE as exc:
        raise SnapshotError(f"The snapshot cannot be unpacked: {exc}") from exc
    missing = sorted(set(manifest.tables) - seen)
    if missing:
        raise SnapshotError("The snapshot is incomplete: no rows for " + ", ".join(missing))
    return manifest


def schema_problems(manifest: Manifest, conn: psycopg.Connection) -> list[str]:
    """What stops `manifest`'s rows from loading into `conn`'s database; empty when none."""
    return schema_diff(manifest.tables, tables(conn))


def load(
    dest: psycopg.Connection,
    unpacked: Path,
    manifest: Manifest,
    on_table: Callable[[str, int, int], None] | None = None,
) -> dict[str, int]:
    """Replace every row of `dest` with the unpacked snapshot's, in one transaction.

    `dest` must be in autocommit mode. Raises `SnapshotError` (nothing written) when the
    schemas differ.
    """
    problems = schema_problems(manifest, dest)
    if problems:
        raise SnapshotError(
            "The snapshot was taken with a different schema: " + "; ".join(problems)
        )
    _apply_copy_settings(dest, local=False)

    def fill(name: str, _columns: Columns, into: psycopg.Copy) -> None:
        with (unpacked / "database" / f"{name}.copy").open("rb") as rows:
            while chunk := rows.read(1 << 20):
                into.write(chunk)

    return replace_rows(dest, manifest.tables, fill, on_table, copy_format="text")


def swap_in(unpacked: Path, roots: Mapping[str, Path], keep: Path) -> None:
    """Move each unpacked folder in place of its root. The folder it replaces goes to
    `keep/<root>` (whatever an earlier restore kept there is dropped first)."""
    shutil.rmtree(keep, ignore_errors=True)
    keep.mkdir(parents=True)
    for root, target in roots.items():
        incoming = unpacked / "files" / root
        incoming.mkdir(parents=True, exist_ok=True)  # the snapshot had nothing in it
        if target.exists():
            shutil.move(target, keep / root)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(incoming, target)

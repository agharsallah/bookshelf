"""Copy every row of one database into another of the same schema (Settings → Database).

A sync is a mirror, not a merge: the destination's rows are replaced by the source's, in
one transaction, so it either ends as an exact copy or is left as it was. The source is
read in one repeatable-read snapshot, so a write landing mid-copy cannot tear it.

Foreign keys are made deferrable for the length of that transaction (and put back before
it commits), so tables load in any order, cycles included (`notes` ↔ `artifacts`); every
check still runs, all at once at the end. Identity sequences are moved past the copied ids.

The schema itself is never copied: both sides must already have the same tables and
columns (`schema_diff`), which is what the migrations guarantee.
"""

import logging
import os
import shutil
import subprocess
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import psycopg
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo

from app.db.migrate import libpq_url

logger = logging.getLogger(__name__)

# Bookkeeping of one cluster (its migration log) and the live workers of one database:
# neither describes the library, and copying them would only confuse the other side.
EXCLUDED = frozenset({"_local_migrations", "workers"})
CONNECT_TIMEOUT = 8

Columns = tuple[tuple[str, str], ...]  # (name, type) in table order
OnTable = Callable[[str, int, int], None]  # table, its index (0-based), how many


def connect(url: str, **kwargs: object) -> psycopg.Connection:
    return psycopg.connect(libpq_url(url), connect_timeout=CONNECT_TIMEOUT, **kwargs)  # type: ignore[arg-type]


def tables(conn: psycopg.Connection) -> dict[str, Columns]:
    """The library's tables and their stored columns (generated ones are computed again)."""
    rows = conn.execute(
        """
        select c.relname, array_agg(array[a.attname, format_type(a.atttypid, a.atttypmod)]
                                    order by a.attnum)
        from pg_class c
        join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
        where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
          and not c.relispartition and a.attgenerated = ''
        group by c.relname
        """
    ).fetchall()
    return {
        name: tuple((col, typ) for col, typ in cols)
        for name, cols in rows
        if name not in EXCLUDED and not name.startswith("_")
    }


def schema_diff(source: Mapping[str, Columns], dest: Mapping[str, Columns]) -> list[str]:
    """What stops a copy from `source` into `dest`, in words; empty when they match."""
    problems: list[str] = []
    for name in sorted(source.keys() - dest.keys()):
        problems.append(f"table {name} is missing on the destination")
    for name in sorted(dest.keys() - source.keys()):
        problems.append(f"table {name} is missing on the source")
    for name in sorted(source.keys() & dest.keys()):
        here, there = dict(source[name]), dict(dest[name])
        for col in sorted(here.keys() - there.keys()):
            problems.append(f"column {name}.{col} is missing on the destination")
        for col in sorted(there.keys() - here.keys()):
            problems.append(f"column {name}.{col} is missing on the source")
        for col in sorted(here.keys() & there.keys()):
            if here[col] != there[col]:
                problems.append(f"column {name}.{col} is {here[col]} here, {there[col]} there")
    return problems


@dataclass(frozen=True)
class Summary:
    """What a database holds, in the few numbers a person compares before a sync."""

    documents: int
    notes: int
    artifacts: int
    collections: int
    running_jobs: int
    last_change: datetime | None


def summary(conn: psycopg.Connection) -> Summary:
    row = conn.execute(
        """
        select (select count(*) from documents),
               (select count(*) from notes),
               (select count(*) from artifacts),
               (select count(*) from collections),
               (select count(*) from jobs where state = 'running'),
               greatest((select max(updated_at) from documents),
                        (select max(created_at) from notes),
                        (select max(updated_at) from reading_positions),
                        (select max(created_at) from artifacts),
                        (select max(updated_at) from collections))
        """
    ).fetchone()
    if row is None:  # pragma: no cover - a select without from always returns its row
        raise RuntimeError("summary query returned nothing")
    return Summary(*row)


def _foreign_keys(conn: psycopg.Connection) -> list[tuple[str, str]]:
    return conn.execute(
        """
        select c.relname, k.conname
        from pg_constraint k join pg_class c on c.oid = k.conrelid
        where k.contype = 'f' and k.connamespace = 'public'::regnamespace
          and not k.condeferrable
        order by 1, 2
        """
    ).fetchall()


def _sequences(conn: psycopg.Connection) -> list[tuple[str, str, str]]:
    """(sequence, table, column) for every identity or serial column of the library."""
    return conn.execute(
        """
        select s.relname, t.relname, a.attname
        from pg_depend d
        join pg_class s on s.oid = d.objid and s.relkind = 'S'
        join pg_class t on t.oid = d.refobjid
        join pg_attribute a on a.attrelid = t.oid and a.attnum = d.refobjsubid
        where s.relnamespace = 'public'::regnamespace and d.deptype in ('a', 'i')
        """
    ).fetchall()


def _alter_keys(conn: psycopg.Connection, keys: list[tuple[str, str]], mode: str) -> None:
    for table, name in keys:
        conn.execute(
            sql.SQL("alter table {} alter constraint {} " + mode).format(
                sql.Identifier(table), sql.Identifier(name)
            )
        )


def copy_all(
    source: psycopg.Connection,
    dest: psycopg.Connection,
    on_table: OnTable | None = None,
) -> dict[str, int]:
    """Replace every row of `dest` with `source`'s. Returns the rows copied per table.

    Both connections must be in autocommit mode (each runs its own transaction here).
    Raises `ValueError` when the schemas differ, before anything is written.
    """
    names = tables(source)
    problems = schema_diff(names, tables(dest))
    if problems:
        raise ValueError("The two databases have different schemas: " + "; ".join(problems))

    copied: dict[str, int] = {}
    # The source's (read-only) transaction ends first; were it to fail, the destination's
    # rolls back with it.
    with dest.transaction(), source.transaction():
        source.execute("set transaction isolation level repeatable read, read only")
        for conn in (source, dest):  # a big table may outlast a server's default timeouts
            conn.execute("set local statement_timeout = 0")
            conn.execute("set local idle_in_transaction_session_timeout = 0")
        keys = _foreign_keys(dest)
        _alter_keys(dest, keys, "deferrable initially deferred")
        dest.execute("set constraints all deferred")
        dest.execute(
            sql.SQL("truncate {}").format(sql.SQL(", ").join(map(sql.Identifier, sorted(names))))
        )
        for index, name in enumerate(sorted(names)):
            if on_table is not None:
                on_table(name, index, len(names))
            cols = sql.SQL(", ").join(sql.Identifier(col) for col, _ in names[name])
            table = sql.Identifier(name)
            out_sql = sql.SQL("copy (select {} from {}) to stdout (format binary)")
            in_sql = sql.SQL("copy {} ({}) from stdin (format binary)")
            with source.cursor() as read, dest.cursor() as write:
                with (
                    read.copy(out_sql.format(cols, table)) as out,
                    write.copy(in_sql.format(table, cols)) as into,
                ):
                    for chunk in out:
                        into.write(chunk)
                copied[name] = write.rowcount  # set once the copy is finished, until close
        dest.execute("set constraints all immediate")  # every foreign key checked, here
        _alter_keys(dest, keys, "not deferrable")
        for seq, table_name, col in _sequences(dest):
            setval = sql.SQL("select setval({}, coalesce((select max({}) from {}), 0) + 1, false)")
            dest.execute(
                setval.format(sql.Literal(seq), sql.Identifier(col), sql.Identifier(table_name))
            )
    return copied


# -- backups ------------------------------------------------------------------------------


def can_back_up() -> bool:
    return shutil.which("pg_dump") is not None


def back_up(url: str, path: Path, *, timeout: float = 1800) -> Path:
    """Dump `url`'s library data to `path` (`pg_restore --data-only` reads it back).

    The password goes through the environment, not the command line, so it never shows in
    a process list. Raises `RuntimeError` with pg_dump's own words when it fails.
    """
    params = conninfo_to_dict(libpq_url(url))
    password = params.pop("password", None)
    path.parent.mkdir(parents=True, exist_ok=True)
    command = [
        "pg_dump", "--data-only", "--schema=public", "--format=custom",
        *(f"--exclude-table=public.{name}" for name in sorted(EXCLUDED)),
        f"--file={path}", f"--dbname={make_conninfo('', **params)}",
    ]  # fmt: skip
    env = {**os.environ, **({"PGPASSWORD": str(password)} if password else {})}
    done = subprocess.run(  # noqa: S603  (argv is built here; the URL comes from settings)
        command, env=env, capture_output=True, text=True, timeout=timeout
    )
    if done.returncode != 0:
        path.unlink(missing_ok=True)
        raise RuntimeError((done.stderr or "pg_dump failed").strip().splitlines()[-1])
    return path

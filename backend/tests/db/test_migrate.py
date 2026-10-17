"""`app.db.migrate`: the schema on any Postgres that is not Supabase, never on Supabase."""

import psycopg

from app.db import migrate as migrations
from app.db.migrate import MIGRATIONS_DIR, libpq_url, migrate, pending

ALL = sorted(path.name for path in MIGRATIONS_DIR.glob("*.sql"))


def _connect(url: str) -> psycopg.Connection:
    return psycopg.connect(libpq_url(url), autocommit=True)


def test_an_empty_database_gets_every_migration_once(bare_url):
    with _connect(bare_url) as conn:
        assert [path.name for path in pending(conn)] == ALL

    assert migrate(bare_url) == ALL
    assert migrate(bare_url) == []
    with _connect(bare_url) as conn:
        assert pending(conn) == []
        assert conn.execute("select to_regclass('public.documents')").fetchone()[0]


def test_a_supabase_database_is_left_to_supabase(bare_url, monkeypatch):
    monkeypatch.setattr(migrations, "supabase_managed", lambda conn: True)

    assert migrate(bare_url) == []
    with _connect(bare_url) as conn:
        assert pending(conn) == []  # nothing reported as missing either
        assert conn.execute("select to_regclass('public._local_migrations')").fetchone()[0] is None


def test_plain_postgres_is_not_mistaken_for_supabase(bare_url):
    with _connect(bare_url) as conn:
        assert not migrations.supabase_managed(conn)

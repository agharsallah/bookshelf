"""Apply `supabase/migrations/*.sql` to a non-Supabase Postgres (local dev, tests).

The SQL files are the single schema source. Supabase applies them through its own
migration tracking (Supabase MCP `apply_migration` / `supabase db push`); this runner
exists so the local cluster and the test databases get the exact same schema.

    uv run python -m app.db.migrate            # uses BOOKSHELF_DATABASE_URL
"""

import logging
from pathlib import Path

import psycopg

from app.core.config import get_settings

logger = logging.getLogger(__name__)

MIGRATIONS_DIR = Path(__file__).resolve().parents[3] / "supabase" / "migrations"


def libpq_url(sqlalchemy_url: str) -> str:
    """`postgresql+psycopg://…` → `postgresql://…` for psycopg's own connect()."""
    scheme, sep, rest = sqlalchemy_url.partition("://")
    return f"{scheme.split('+', 1)[0]}{sep}{rest}"


def pending_migrations(applied: set[str]) -> list[Path]:
    return [path for path in sorted(MIGRATIONS_DIR.glob("*.sql")) if path.name not in applied]


def migrate(database_url: str) -> list[str]:
    """Apply every pending migration, each in its own transaction. Returns their names."""
    done: list[str] = []
    with psycopg.connect(libpq_url(database_url), autocommit=True) as conn:
        conn.execute(
            "create table if not exists _local_migrations "
            "(name text primary key, applied_at timestamptz not null default now())"
        )
        applied = {row[0] for row in conn.execute("select name from _local_migrations")}
        for path in pending_migrations(applied):
            with conn.transaction():
                conn.execute(path.read_text(encoding="utf-8").encode())
                conn.execute("insert into _local_migrations (name) values (%s)", (path.name,))
            logger.info("Applied migration", extra={"migration": path.name})
            done.append(path.name)
    return done


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    names = migrate(get_settings().database_url)
    print(f"Applied {len(names)} migration(s): {', '.join(names) or 'none pending'}")

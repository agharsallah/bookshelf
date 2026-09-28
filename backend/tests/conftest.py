"""Test fixtures.

Each pytest process gets its own throwaway Postgres database on the local cluster
(`scripts/pg-local.sh start`), migrated from `supabase/migrations/`. That keeps runs
isolated from dev data and from each other (parallel runs never share a database).
Tables are truncated between tests, which is much cheaper than re-migrating.

Environment variables are set before any `app.*` import, because `Settings` is cached
and `app.db.session` builds its engine at import time.
"""

import os
import sys
import tempfile
import uuid
from collections.abc import Iterator
from pathlib import Path

import psycopg
import pytest

# `qdrant_client` imports fastembed, and with it onnxruntime, whenever it is installed.
# Tests never embed for real (`FakeEmbedder`), and onnxruntime's native teardown
# intermittently aborted the interpreter at exit (code 134). A `None` entry makes
# `import fastembed` fail, so qdrant_client falls back exactly as if it were not installed.
sys.modules.setdefault("fastembed", None)

_ADMIN_URL = os.environ.get(
    "BOOKSHELF_TEST_ADMIN_URL", "postgresql://bookshelf@127.0.0.1:54329/postgres"
)
# `from tests.conftest import ...` runs this module a second time (pytest loaded it as
# `conftest`): reuse the first run's database and folders instead of creating new ones.
_FIRST_RUN = "BOOKSHELF_TEST_DB_NAME" not in os.environ
_DB_NAME = os.environ.setdefault(
    "BOOKSHELF_TEST_DB_NAME", f"bookshelf_test_{os.getpid()}_{uuid.uuid4().hex[:6]}"
)
_TMP = Path(os.environ.setdefault("BOOKSHELF_TEST_TMP", tempfile.mkdtemp(prefix="bookshelf-test-")))
_DB_URL = _ADMIN_URL.rsplit("/", 1)[0].replace("postgresql://", "postgresql+psycopg://", 1)

os.environ.update(
    {
        "BOOKSHELF_ENVIRONMENT": "test",
        "BOOKSHELF_DATABASE_URL": f"{_DB_URL}/{_DB_NAME}",
        "BOOKSHELF_API_KEY": "test-secret-key",
        "BOOKSHELF_LOG_JSON": "false",
        "BOOKSHELF_LOG_LEVEL": "WARNING",
        "BOOKSHELF_RATE_LIMIT_REQUESTS": "1000",
        "BOOKSHELF_ALLOWED_HOSTS": "*",
        "BOOKSHELF_LIBRARY_DIR": str(_TMP / "library"),
        "BOOKSHELF_MEDIA_DIR": str(_TMP / "media"),
        "BOOKSHELF_EXPORTS_DIR": str(_TMP / "exports"),
        "BOOKSHELF_AUDIO_DIR": str(_TMP / "audio"),
        "BOOKSHELF_VOICES_DIR": str(_TMP / "voices"),
        "BOOKSHELF_QDRANT_URL": "",
        "BOOKSHELF_QDRANT_PATH": str(_TMP / "qdrant"),
        "BOOKSHELF_API_EMBED_RUNNER": "false",  # tests drive jobs themselves
        "BOOKSHELF_API_WORKER": "false",
        "BOOKSHELF_API_NARRATE_RUNNER": "false",  # it would voice queued scripts for real
        "BOOKSHELF_CLAUDE_BIN": "/nonexistent/claude-must-be-faked-in-tests",
        # A developer `.env` may put tiers on other models or efforts; tests assert the ladder.
        "BOOKSHELF_MODEL_EXPLORE": "",
        "BOOKSHELF_MODEL_DISTIL": "",
        "BOOKSHELF_MODEL_REASON": "",
        "BOOKSHELF_EFFORT_EXPLORE": "",
        "BOOKSHELF_EFFORT_DISTIL": "",
        "BOOKSHELF_EFFORT_REASON": "",
    }
)
(_TMP / "library").mkdir(exist_ok=True)


def _admin() -> psycopg.Connection:
    try:
        return psycopg.connect(_ADMIN_URL, autocommit=True, connect_timeout=3)
    except psycopg.OperationalError as exc:  # pragma: no cover - environment problem
        raise pytest.UsageError(
            f"Test Postgres unreachable at {_ADMIN_URL}. Run `scripts/pg-local.sh start`."
        ) from exc


if _FIRST_RUN:
    with _admin() as _conn:
        _conn.execute(f'create database "{_DB_NAME}"')

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402
from sqlmodel import Session  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.db.migrate import migrate  # noqa: E402
from app.db.session import engine  # noqa: E402
from app.main import create_app  # noqa: E402

migrate(get_settings().database_url)

API_KEY = "test-secret-key"
AUTH = {"X-API-Key": API_KEY}
# Children first, so plain DELETEs satisfy foreign keys. DELETE on a handful of rows is
# ~10x cheaper than TRUNCATE, whose fixed per-table cost dominated the suite's runtime.
_TABLES = (
    "activity_minutes",
    "review_logs",
    "review_items",
    "recall_grades",
    "recalls",
    "edges",
    "concepts",
    "model_runs",
    "jobs",
    "workers",
    "artifacts",
    "notes",
    "reading_positions",
    "nodes",
    "documents",
)


def pytest_sessionfinish(session: pytest.Session, exitstatus: int) -> None:
    from app.retrieval.client import close_client

    close_client()
    engine.dispose()
    with _admin() as conn:
        conn.execute(f'drop database if exists "{_DB_NAME}" with (force)')


def idle_transactions() -> int:
    """Connections to the test database sitting idle inside an open transaction: what a
    session holds while it waits on slow non-database work (a CLI run, an embedding)."""
    with _admin() as conn:
        row = conn.execute(
            "select count(*) from pg_stat_activity "
            "where datname = %s and state like 'idle in transaction%%'",
            (engine.url.database,),  # not `_DB_NAME`: `tests.conftest` imports run it anew
        ).fetchone()
    return int(row[0]) if row else 0


@pytest.fixture(autouse=True)
def _clean_tables() -> Iterator[None]:
    yield
    with engine.begin() as conn:
        for table in _TABLES:
            conn.execute(text(f"delete from {table}"))  # noqa: S608  (constant names)


@pytest.fixture
def session() -> Iterator[Session]:
    with Session(engine) as db:
        yield db


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(create_app()) as test_client:
        yield test_client


@pytest.fixture
def library_dir() -> Path:
    return get_settings().library_dir

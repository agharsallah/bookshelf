"""Test fixtures.

Each pytest process gets its own throwaway Postgres database on the local cluster
(`scripts/pg-local.sh start`), migrated from `supabase/migrations/`. That keeps runs
isolated from dev data and from each other (parallel runs never share a database).
Tables are truncated between tests, which is much cheaper than re-migrating.

Environment variables are set before any `app.*` import, because `Settings` is cached
and `app.db.session` builds its engine at import time.
"""

import os
import tempfile
import uuid
from collections.abc import Iterator
from pathlib import Path

import psycopg
import pytest

_ADMIN_URL = os.environ.get(
    "BOOKSHELF_TEST_ADMIN_URL", "postgresql://bookshelf@127.0.0.1:54329/postgres"
)
_DB_NAME = f"bookshelf_test_{os.getpid()}_{uuid.uuid4().hex[:6]}"
_TMP = Path(tempfile.mkdtemp(prefix="bookshelf-test-"))
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
        "BOOKSHELF_QDRANT_URL": "",
        "BOOKSHELF_QDRANT_PATH": str(_TMP / "qdrant"),
        "BOOKSHELF_CLAUDE_BIN": "/nonexistent/claude-must-be-faked-in-tests",
    }
)
(_TMP / "library").mkdir()


def _admin() -> psycopg.Connection:
    try:
        return psycopg.connect(_ADMIN_URL, autocommit=True, connect_timeout=3)
    except psycopg.OperationalError as exc:  # pragma: no cover - environment problem
        raise pytest.UsageError(
            f"Test Postgres unreachable at {_ADMIN_URL}. Run `scripts/pg-local.sh start`."
        ) from exc


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
_TABLES = ("edges", "concepts", "jobs", "artifacts", "notes", "nodes", "documents")


def pytest_sessionfinish(session: pytest.Session, exitstatus: int) -> None:
    engine.dispose()
    with _admin() as conn:
        conn.execute(f'drop database if exists "{_DB_NAME}" with (force)')


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

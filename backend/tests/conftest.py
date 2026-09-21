"""Test fixtures.

Environment variables are set before any `app.*` import, because `Settings` is cached
and `app.db.session` builds its engine at import time.
"""

import os
import tempfile
from collections.abc import Iterator
from pathlib import Path

import pytest

_TMP_DB = Path(tempfile.mkdtemp(prefix="bookshelf-test-")) / "test.db"

os.environ.update(
    {
        "BOOKSHELF_ENVIRONMENT": "test",
        "BOOKSHELF_DATABASE_URL": f"sqlite:///{_TMP_DB}",
        "BOOKSHELF_API_KEY": "test-secret-key",
        "BOOKSHELF_LOG_JSON": "false",
        "BOOKSHELF_LOG_LEVEL": "WARNING",
        "BOOKSHELF_RATE_LIMIT_REQUESTS": "1000",
        "BOOKSHELF_ALLOWED_HOSTS": "*",
    }
)

from fastapi.testclient import TestClient  # noqa: E402
from sqlmodel import SQLModel  # noqa: E402

from app.db.session import engine  # noqa: E402
from app.main import create_app  # noqa: E402

API_KEY = "test-secret-key"
AUTH = {"X-API-Key": API_KEY}


@pytest.fixture
def client() -> Iterator[TestClient]:
    """A client with a clean database per test."""
    SQLModel.metadata.drop_all(engine)
    SQLModel.metadata.create_all(engine)
    with TestClient(create_app()) as test_client:
        yield test_client
    SQLModel.metadata.drop_all(engine)


@pytest.fixture
def book_payload() -> dict[str, object]:
    return {
        "title": "Thinking in Systems",
        "author": "Donella Meadows",
        "status": "reading",
        "tags": ["systems"],
    }

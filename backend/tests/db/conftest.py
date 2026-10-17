"""A second throwaway database beside the test one, so a sync has somewhere to go."""

from collections.abc import Iterator

import psycopg
import pytest
from psycopg import sql

from app.core.config import get_settings
from app.db.migrate import libpq_url, migrate
from app.db.sync import tables
from tests.conftest import _admin


@pytest.fixture(scope="session")
def peer_url() -> Iterator[str]:
    main = get_settings().database_url
    # Not `bookshelf_test_<pid>_…`: that pattern is the one database per process.
    name = main.rsplit("/", 1)[1].replace("bookshelf_test_", "bookshelf_peer_", 1)
    with _admin() as conn:
        conn.execute(f'drop database if exists "{name}" with (force)')
        conn.execute(f'create database "{name}"')
    url = f"{main.rsplit('/', 1)[0]}/{name}"
    migrate(url)
    yield url
    with _admin() as conn:
        conn.execute(f'drop database if exists "{name}" with (force)')


@pytest.fixture
def bare_url() -> Iterator[str]:
    """An empty database, never migrated: a Postgres server set up for the app just now."""
    main = get_settings().database_url
    name = main.rsplit("/", 1)[1].replace("bookshelf_test_", "bookshelf_bare_", 1)
    with _admin() as conn:
        conn.execute(f'drop database if exists "{name}" with (force)')
        conn.execute(f'create database "{name}"')
    yield f"{main.rsplit('/', 1)[0]}/{name}"
    with _admin() as conn:
        conn.execute(f'drop database if exists "{name}" with (force)')


@pytest.fixture
def peer(peer_url: str) -> Iterator[psycopg.Connection]:
    """The peer database, emptied: each test starts from nothing there."""
    with psycopg.connect(libpq_url(peer_url), autocommit=True) as conn:
        names = sql.SQL(", ").join(map(sql.Identifier, sorted(tables(conn))))
        conn.execute(sql.SQL("truncate {}").format(names))
        yield conn


@pytest.fixture
def main_db() -> Iterator[psycopg.Connection]:
    with psycopg.connect(libpq_url(get_settings().database_url), autocommit=True) as conn:
        yield conn

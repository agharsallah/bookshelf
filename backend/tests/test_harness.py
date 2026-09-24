"""The test harness itself: one throwaway database per pytest process, dropped at exit."""

import os

import psycopg

from app.db.session import engine


def test_importing_the_conftest_module_creates_no_second_database():
    """Tests import helpers `from tests.conftest`, which runs the module a second time under
    that name; it must reuse the process's database, or each run leaks one."""
    from tests import conftest

    admin = os.environ.get("BOOKSHELF_TEST_ADMIN_URL", conftest._ADMIN_URL)
    with psycopg.connect(admin, autocommit=True) as conn:
        mine = conn.execute(
            "select count(*) from pg_database where datname like %s",
            (f"bookshelf_test_{os.getpid()}_%",),
        ).fetchone()

    assert conftest._DB_NAME == engine.url.database
    assert mine == (1,)

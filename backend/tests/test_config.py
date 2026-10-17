"""Settings: the main database from libpq's `PG*` variables (a Postgres server of your own)."""

from app.core.config import Settings


def _settings(**values: str) -> Settings:
    return Settings(_env_file=None, **values)  # type: ignore[call-arg]


def test_pg_variables_make_the_database_url_ahead_of_the_bookshelf_one():
    settings = _settings(
        environment="production", api_key="k", allowed_hosts="api.example", cors_origins="https://x",
        PGHOST="10.0.0.5", PGPORT="6432", PGDATABASE="bookshelf", PGUSER="shelf",
        PGPASSWORD="p@ss:w/rd", PGSSLMODE="require",
    )  # fmt: skip

    assert settings.database_url == (
        "postgresql+psycopg://shelf:p%40ss%3Aw%2Frd@10.0.0.5:6432/bookshelf?sslmode=require"
    )
    assert "p@ss" not in repr(settings)


def test_without_a_password_or_port_the_defaults_apply():
    settings = _settings(environment="local", PGHOST="vm.lan", PGUSER="shelf")

    assert settings.database_url == "postgresql+psycopg://shelf@vm.lan:5432/shelf"


def test_tests_never_follow_pg_variables():
    settings = _settings(environment="test", PGHOST="vm.lan", PGPASSWORD="secret")

    assert "vm.lan" not in settings.database_url


def test_without_pghost_the_bookshelf_url_is_kept():
    settings = _settings(environment="local", database_url="postgresql+psycopg://a@b:1/c")

    assert settings.database_url == "postgresql+psycopg://a@b:1/c"

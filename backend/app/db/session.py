"""Database engine and per-request session.

Docs: https://fastapi.tiangolo.com/tutorial/sql-databases/
"""

from collections.abc import Generator

from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlmodel import Session, SQLModel, create_engine

from app.core.config import get_settings

settings = get_settings()

_connect_args: dict[str, object] = {}
if settings.database_url.startswith("sqlite"):
    # One request can touch more than one thread; SQLModel keeps one session per request.
    _connect_args = {"check_same_thread": False}

engine = create_engine(
    settings.database_url,
    echo=settings.database_echo,
    connect_args=_connect_args,
    pool_pre_ping=True,
)


@event.listens_for(Engine, "connect")
def _sqlite_pragmas(dbapi_connection: object, _: object) -> None:
    """SQLite defaults are unsafe for concurrent readers and ignore foreign keys."""
    if not settings.database_url.startswith("sqlite"):
        return
    cursor = dbapi_connection.cursor()  # type: ignore[attr-defined]
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.close()


def init_db() -> None:
    """Create tables. Swap for Alembic migrations once the schema starts moving."""
    import app.models  # noqa: F401  (import for side effect: registers table metadata)

    SQLModel.metadata.create_all(engine)


def get_session() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session

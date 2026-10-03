"""Database engine and per-request session.

Postgres only: the schema relies on JSONB, text[], generated tsvector columns and
`FOR UPDATE SKIP LOCKED`. The schema itself is owned by `supabase/migrations/*.sql`
(applied by Supabase, or by `app.db.migrate` locally), never by `create_all()`.

Docs: https://fastapi.tiangolo.com/tutorial/sql-databases/
"""

import threading
from collections.abc import Generator

from sqlalchemy import Engine
from sqlmodel import Session, create_engine

from app.core.config import get_settings
from app.db.targets import DatabaseTarget, stored_target, url_for

settings = get_settings()


def make_engine(url: str) -> Engine:
    return create_engine(
        url,
        echo=settings.database_echo,
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=5,
        # Supabase's transaction pooler (port 6543) does not support prepared statements.
        connect_args={"prepare_threshold": None},
    )


# The engine of the database the app reads and writes (`app/db/targets.py`). Settings →
# Database swaps it at runtime, so code asks `get_engine()` (or reads `engine`, below) each
# time it opens a session instead of keeping a reference.
_lock = threading.Lock()
_target: DatabaseTarget = stored_target(settings)
_engine: Engine = make_engine(url_for(settings, _target))


def get_engine() -> Engine:
    return _engine


def active_target() -> DatabaseTarget:
    return _target


def use_target(target: DatabaseTarget, url: str | None = None) -> None:
    """Point every new session at `target`'s database (at `url`, when given). Sessions
    already open finish on the old one; its pool is closed once they are returned."""
    global _engine, _target
    with _lock:
        if target is _target and url is None:
            return
        old, _engine, _target = _engine, make_engine(url or url_for(settings, target)), target
    old.dispose()


def __getattr__(name: str) -> Engine:
    """`from app.db.session import engine` still works and gets the current engine."""
    if name == "engine":
        return _engine
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


def get_session() -> Generator[Session, None, None]:
    with Session(get_engine()) as session:
        yield session


def release(session: Session) -> None:
    """End the session's transaction before slow work that needs no database (a CLI run,
    an embedding batch), so its pooled connection is returned instead of sitting idle in a
    transaction, holding row locks. Pending changes are committed; loaded objects keep
    their state (not expired, so reading them afterwards costs no query per object)."""
    expire = session.expire_on_commit
    session.expire_on_commit = False
    try:
        session.commit()
    finally:
        session.expire_on_commit = expire

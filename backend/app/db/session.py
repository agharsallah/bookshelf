"""Database engine and per-request session.

Postgres only: the schema relies on JSONB, text[], generated tsvector columns and
`FOR UPDATE SKIP LOCKED`. The schema itself is owned by `supabase/migrations/*.sql`
(applied by Supabase, or by `app.db.migrate` locally), never by `create_all()`.

Docs: https://fastapi.tiangolo.com/tutorial/sql-databases/
"""

from collections.abc import Generator

from sqlmodel import Session, create_engine

from app.core.config import get_settings

settings = get_settings()

engine = create_engine(
    settings.database_url,
    echo=settings.database_echo,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=5,
    # Supabase's transaction pooler (port 6543) does not support prepared statements.
    connect_args={"prepare_threshold": None},
)


def get_session() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session

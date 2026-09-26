"""Worker liveness over the `workers` table.

A queued job says nothing about whether anything will ever run it: with no worker
process, it waits forever and looks exactly like one about to start. So every worker
(`app.jobs.worker`, standalone or inside the API) upserts its row when it starts and
refreshes `seen_at` every `BEAT_SECONDS` while it polls, and deletes it on a clean stop.
A worker is alive while its row is younger than `ALIVE_WITHIN`; a crashed one's row
just goes stale and is pruned by the next worker that starts.
"""

import uuid
from collections.abc import Collection
from datetime import UTC, datetime, timedelta

from sqlalchemy import text
from sqlmodel import Session, col, select

from app.models import WorkerRow
from app.models.enums import JobKind

BEAT_SECONDS = 5.0
ALIVE_WITHIN = timedelta(seconds=30)
_PRUNE_AFTER = timedelta(days=1)


def beat(
    session: Session,
    worker_id: uuid.UUID,
    *,
    name: str,
    kinds: Collection[JobKind],
    concurrency: int,
    running: int,
) -> None:
    """Insert or refresh this worker's row. Commits."""
    session.execute(
        text(
            """
            insert into workers (id, name, kinds, concurrency, running)
            values (:id, :name, :kinds, :concurrency, :running)
            on conflict (id) do update
              set seen_at = now(), running = excluded.running, kinds = excluded.kinds
            """
        ),
        {
            "id": worker_id,
            "name": name,
            "kinds": sorted(k.value for k in kinds),
            "concurrency": concurrency,
            "running": running,
        },
    )
    session.commit()


def leave(session: Session, worker_id: uuid.UUID) -> None:
    """Remove this worker's row (a clean stop). Commits."""
    session.execute(text("delete from workers where id = :id"), {"id": worker_id})
    session.commit()


def prune(session: Session) -> None:
    """Forget workers that have not been seen for a day (crashed long ago). Commits."""
    cutoff = datetime.now(UTC) - _PRUNE_AFTER
    session.execute(text("delete from workers where seen_at < :cutoff"), {"cutoff": cutoff})
    session.commit()


def alive(session: Session) -> list[WorkerRow]:
    """Workers seen within `ALIVE_WITHIN`, oldest first."""
    cutoff = datetime.now(UTC) - ALIVE_WITHIN
    query = select(WorkerRow).where(col(WorkerRow.seen_at) >= cutoff)
    return list(session.exec(query.order_by(col(WorkerRow.started_at))))

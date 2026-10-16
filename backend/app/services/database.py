"""Settings → Database: which database the app reads and writes, and syncing one into the
other (`app/db/targets.py`, `app/db/sync.py`).

A switch stops the API's background runners (their running jobs go back to the queue they
came from), points new sessions at the other database, saves the choice and starts the
runners again. A sync runs on a thread of its own; the page polls `status()` for progress.
While a sync writes into the database the app is using, the runners are stopped too.

Before either touches this computer's cluster, its pending migrations are applied, as
`scripts/pg-local.sh` does. The main database is migrated by Supabase, never from here.
"""

import logging
import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime

import psycopg

from app.core.config import Settings
from app.core.errors import ConflictError
from app.db import session as db_session
from app.db import sync
from app.db.migrate import migrate, pending_migrations
from app.db.sync import Columns
from app.db.targets import DatabaseTarget, has_two, host, label, other, save_target, url_for
from app.jobs.runners import Runners
from app.schemas.database import (
    DatabaseCounts,
    DatabaseStatus,
    DatabaseTargetPublic,
    SyncProgress,
)
from app.services.exclusive import Exclusive

logger = logging.getLogger(__name__)

RunnersOf = Callable[[], Runners | None]
Tables = dict[str, Columns]


def _now() -> datetime:
    return datetime.now(UTC)


def _reason(exc: BaseException) -> str:
    """A database error in one line, without the connection string."""
    text = str(exc).strip().splitlines()
    return text[0] if text else type(exc).__name__


class DatabaseService:
    def __init__(
        self,
        settings: Settings,
        runners: RunnersOf = lambda: None,
        exclusive: Exclusive | None = None,
    ) -> None:
        self.settings = settings
        self._runners = runners
        # Shared with the snapshots (`app.services.snapshots`): one of them at a time.
        self.exclusive = exclusive or Exclusive()
        self._lock = threading.Lock()
        self._progress = SyncProgress()
        self._thread: threading.Thread | None = None

    def bind_runners(self, runners: RunnersOf) -> None:
        """Whose background runners a switch or sync stops and starts again."""
        self._runners = runners

    # -- reading ----------------------------------------------------------------------

    def url(self, target: DatabaseTarget) -> str:
        return url_for(self.settings, target)

    def _pending(self, conn: psycopg.Connection, target: DatabaseTarget) -> int:
        if target is not DatabaseTarget.LOCAL:
            return 0
        exists = conn.execute("select to_regclass('public._local_migrations')").fetchone()
        applied = (
            {row[0] for row in conn.execute("select name from _local_migrations")}
            if exists and exists[0]
            else set()
        )
        return len(pending_migrations(applied))

    def _describe(self, target: DatabaseTarget) -> tuple[DatabaseTargetPublic, Tables | None]:
        url = self.url(target)
        view = DatabaseTargetPublic(
            target=target,
            label=label(self.settings, target),
            host=host(url),
            active=target is db_session.active_target(),
            reachable=False,
        )
        try:
            with sync.connect(url, autocommit=True) as conn:
                view.reachable = True
                view.pending_migrations = self._pending(conn, target)
                tables = sync.tables(conn)
                if view.pending_migrations == 0:
                    view.counts = DatabaseCounts(**vars(sync.summary(conn)))
                return view, tables
        except psycopg.Error as exc:
            view.error = _reason(exc)
            return view, None

    def status(self) -> DatabaseStatus:
        active = db_session.active_target()
        available = has_two(self.settings)
        targets = list(DatabaseTarget) if available else [active]
        with ThreadPoolExecutor(max_workers=2) as pool:  # the remote one takes a round trip
            described = list(pool.map(self._describe, targets))
        problems: list[str] = []
        if available:
            (local, local_tables), (_, remote_tables) = described
            if local.pending_migrations == 0 and local_tables is not None and remote_tables:
                problems = sync.schema_diff(local_tables, remote_tables)
        with self._lock:
            progress = self._progress.model_copy()
        return DatabaseStatus(
            available=available,
            active=active,
            targets=[view for view, _ in described],
            schema_problems=problems,
            can_back_up=sync.can_back_up(),
            sync=progress,
        )

    # -- checks shared by switch and sync ------------------------------------------------

    def _require_two(self) -> None:
        if not has_two(self.settings):
            raise ConflictError(
                "Only one database is configured: set BOOKSHELF_LOCAL_DATABASE_URL and "
                "BOOKSHELF_DATABASE_URL to two different databases."
            )

    def _prepare(self, *targets: DatabaseTarget) -> dict[DatabaseTarget, Tables]:
        """Reach each database (migrating this computer's first) and return its tables.
        Raises `ConflictError` with the reason when one cannot be used."""
        found: dict[DatabaseTarget, Tables] = {}
        for target in targets:
            name = label(self.settings, target)
            try:
                if target is DatabaseTarget.LOCAL:
                    migrate(self.url(target))
                with sync.connect(self.url(target), autocommit=True) as conn:
                    found[target] = sync.tables(conn)
            except psycopg.Error as exc:
                raise ConflictError(f"{name} cannot be reached: {_reason(exc)}") from exc
        return found

    def _require_same_schema(self, tables: dict[DatabaseTarget, Tables]) -> None:
        local, remote = tables[DatabaseTarget.LOCAL], tables[DatabaseTarget.REMOTE]
        problems = sync.schema_diff(local, remote)
        if problems:
            raise ConflictError(
                "The two databases have different schemas. Apply the migrations to "
                f"{label(self.settings, DatabaseTarget.REMOTE)} first.",
                [{"message": problem} for problem in problems],
            )

    # -- switching ----------------------------------------------------------------------

    def switch(self, target: DatabaseTarget) -> DatabaseStatus:
        self._require_two()
        if target is not db_session.active_target():
            self.exclusive.claim("A switch")
            try:
                self._switch(target)
            finally:
                self.exclusive.release()
        return self.status()

    def _switch(self, target: DatabaseTarget) -> None:
        self._require_same_schema(self._prepare(*DatabaseTarget))
        runners = self._runners()
        if runners is not None:
            runners.stop()
        try:
            db_session.use_target(target, self.url(target))
            save_target(self.settings, target)
        finally:
            if runners is not None:
                runners.start()
        logger.info("Database switched", extra={"target": target.value})

    # -- syncing ------------------------------------------------------------------------

    def start_sync(self, source: DatabaseTarget, *, backup: bool) -> SyncProgress:
        """Check that `source` can be copied over the other database, then copy it on a
        thread. Raises `ConflictError` (nothing started) when it cannot."""
        self._require_two()
        dest = other(source)
        self.exclusive.claim("A sync")
        with self._lock:
            self._progress = SyncProgress(
                state="running", source=source, dest=dest, step="Checking both databases",
                started_at=_now(),
            )  # fmt: skip
        try:
            self._require_same_schema(self._prepare(*DatabaseTarget))
            self._require_no_running_jobs()
            if backup and not sync.can_back_up():
                raise ConflictError("pg_dump is not installed, so no backup can be made.")
        except Exception:
            with self._lock:
                self._progress = SyncProgress()
            self.exclusive.release()
            raise
        self._thread = threading.Thread(
            target=self._sync, args=(source, dest, backup), name="database-sync", daemon=True
        )
        self._thread.start()
        with self._lock:
            return self._progress.model_copy()

    def _require_no_running_jobs(self) -> None:
        for target in DatabaseTarget:
            with sync.connect(self.url(target), autocommit=True) as conn:
                row = conn.execute("select count(*) from jobs where state = 'running'").fetchone()
            running = row[0] if row else 0
            if running:
                raise ConflictError(
                    f"{running} job(s) are running on {label(self.settings, target)}. "
                    "Sync once they finish, so none is lost halfway."
                )

    def wait(self, timeout: float | None = None) -> SyncProgress:
        if self._thread is not None:
            self._thread.join(timeout)
        with self._lock:
            return self._progress.model_copy()

    def _update(self, **changes: object) -> None:
        with self._lock:
            self._progress = self._progress.model_copy(update=changes)

    def _sync(self, source: DatabaseTarget, dest: DatabaseTarget, backup: bool) -> None:
        dest_name = label(self.settings, dest)
        runners = self._runners() if dest is db_session.active_target() else None
        stopped = False
        try:
            if backup:
                self._update(step=f"Backing up {dest_name}")
                stamp = _now().strftime("%Y%m%d-%H%M%S")
                path = self.settings.database_backups_dir / f"{dest.value}-{stamp}.dump"
                self._update(backup_path=str(sync.back_up(self.url(dest), path)))
            if runners is not None:  # nothing may write into the database being replaced
                runners.stop()
                stopped = True

            def on_table(table: str, index: int, total: int) -> None:
                self._update(step=f"Copying {table}", table=table, tables_done=index,
                             tables_total=total)  # fmt: skip

            with (
                sync.connect(self.url(source), autocommit=True) as src,
                sync.connect(self.url(dest), autocommit=True) as dst,
            ):
                copied = sync.copy_all(src, dst, on_table)
            self._update(
                state="done", step="Done", table=None, tables_done=len(copied),
                rows=sum(copied.values()), finished_at=_now(),
            )  # fmt: skip
            logger.info("Database synced", extra={"source": source.value, "dest": dest.value,
                        "rows": sum(copied.values())})  # fmt: skip
        except Exception as exc:  # reported on the page; the destination is left as it was
            logger.exception("Database sync failed")
            self._update(state="failed", step="Failed", error=_reason(exc), finished_at=_now())
        finally:
            if stopped and runners is not None:
                runners.start()
            self.exclusive.release()

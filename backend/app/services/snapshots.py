"""Settings → Database → Snapshot: the whole shelf as one file, made here and restored
elsewhere (or back here), so two installs can hold the same state (`app/db/snapshot.py`).

A snapshot reads the database the app uses (`db_session.active_target()`) and the library,
media and audio folders. Making one and restoring one run on a thread of their own; the
page polls `status()`. Only the last snapshot made is kept: a new one replaces it.

A restore is accepted only when nothing is running (no other sync, snapshot or restore,
and no job), since it replaces every row and folder. It stops the API's runners while it
writes, hands any job the snapshot caught mid-run back to the queue, and queues an `embed`
rebuild so search catches up with the restored rows.
"""

import logging
import re
import shutil
import threading
import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path

import psycopg
from sqlmodel import Session, col, select

from app.core.config import Settings
from app.core.errors import ConflictError, NotFoundError
from app.db import session as db_session
from app.db import snapshot, sync
from app.db.migrate import migrate
from app.db.targets import DatabaseTarget, label, url_for
from app.jobs import queue
from app.jobs.queue import JobSpec
from app.jobs.runners import Runners
from app.models import Job
from app.models.enums import JobKind, JobState
from app.schemas.snapshots import SnapshotAction, SnapshotFile, SnapshotProgress, SnapshotStatus
from app.services.exclusive import Exclusive

logger = logging.getLogger(__name__)

RunnersOf = Callable[[], Runners | None]
PREFIX = "bookshelf-"
_EXPORT_NAME = re.compile(rf"{PREFIX}\d{{8}}-\d{{6}}{re.escape(snapshot.SUFFIX)}")
KEPT = "before-restore"  # the folders the last restore replaced


def _now() -> datetime:
    return datetime.now(UTC)


def _stamp() -> str:
    return _now().strftime("%Y%m%d-%H%M%S")


def _reason(exc: BaseException) -> str:
    text = str(exc).strip().splitlines()
    return text[0] if text else type(exc).__name__


class SnapshotService:
    def __init__(
        self,
        settings: Settings,
        exclusive: Exclusive | None = None,
        runners: RunnersOf = lambda: None,
    ) -> None:
        self.settings = settings
        self.exclusive = exclusive or Exclusive()
        self._runners = runners
        self._lock = threading.Lock()
        self._progress = SnapshotProgress()
        self._thread: threading.Thread | None = None

    def bind_runners(self, runners: RunnersOf) -> None:
        self._runners = runners

    @property
    def folder(self) -> Path:
        return self.settings.snapshots_dir

    def roots(self) -> dict[str, Path]:
        """The folders a snapshot carries, by their name inside it (`snapshot.ROOTS`)."""
        s = self.settings
        return {"library": s.library_dir, "media": s.media_dir, "audio": s.audio_dir}

    def _target(self) -> DatabaseTarget:
        return db_session.active_target()

    def _url(self) -> str:
        """The database the app uses, its pending migrations applied when it is this
        computer's (as `scripts/pg-local.sh` does): a snapshot is always of the latest schema."""
        url = url_for(self.settings, self._target())
        if self._target() is DatabaseTarget.LOCAL:
            migrate(url)
        return url

    # -- reading ----------------------------------------------------------------------

    def latest(self) -> Path | None:
        found = [p for p in self.folder.glob(f"{PREFIX}*") if _EXPORT_NAME.fullmatch(p.name)]
        return max(found, key=lambda p: p.name) if found else None  # names sort by time

    def _describe(self, path: Path) -> SnapshotFile | None:
        try:
            manifest = snapshot.read_manifest(path)
        except (snapshot.SnapshotError, OSError):
            return None
        return SnapshotFile(
            name=path.name,
            size_bytes=path.stat().st_size,
            created_at=manifest.created_at,
            documents=manifest.rows.get("documents", 0),
            files=sum(manifest.files.values()),
        )

    def status(self) -> SnapshotStatus:
        latest = self.latest()
        with self._lock:
            progress = self._progress.model_copy()
        return SnapshotStatus(
            database=label(self.settings, self._target()),
            can_back_up=sync.can_back_up(),
            max_bytes=self.settings.snapshot_max_bytes,
            latest=self._describe(latest) if latest else None,
            progress=progress,
        )

    def download(self) -> Path:
        """The last snapshot made here (one being made is not there until it is complete).
        Raises `NotFoundError` when there is none."""
        latest = self.latest()
        if latest is None:
            raise NotFoundError("No snapshot has been made here yet.")
        return latest

    def wait(self, timeout: float | None = None) -> SnapshotProgress:
        if self._thread is not None:
            self._thread.join(timeout)
        with self._lock:
            return self._progress.model_copy()

    def _update(self, **changes: object) -> None:
        with self._lock:
            self._progress = self._progress.model_copy(update=changes)

    def _on_step(self, step: str, done: int, total: int) -> None:
        self._update(step=step, done=done, total=total)

    def _start(self, action: SnapshotAction, work: Callable[[], None]) -> SnapshotProgress:
        """Run `work` on a thread, reporting its end; the hold is let go when it ends."""
        with self._lock:
            self._progress = SnapshotProgress(
                state="running", action=action, step="Starting", started_at=_now()
            )

        def run() -> None:
            try:
                work()
                self._update(state="done", step="Done", finished_at=_now())
            except Exception as exc:  # reported on the page
                logger.exception("Snapshot %s failed", action)
                self._update(state="failed", step="Failed", error=_reason(exc),
                             finished_at=_now())  # fmt: skip
            finally:
                self.exclusive.release()

        self._thread = threading.Thread(target=run, name=f"snapshot-{action}", daemon=True)
        self._thread.start()
        with self._lock:
            return self._progress.model_copy()

    # -- making one ----------------------------------------------------------------------

    def start_export(self) -> SnapshotProgress:
        """Make a snapshot on a thread. Raises `ConflictError` when another operation runs."""
        self.exclusive.claim("A snapshot")
        try:
            url = self._url()
        except psycopg.Error as exc:
            self.exclusive.release()
            raise ConflictError(f"The database cannot be reached: {_reason(exc)}") from exc
        return self._start("export", lambda: self._export(url))

    def _export(self, url: str) -> None:
        self.folder.mkdir(parents=True, exist_ok=True)
        path = self.folder / f"{PREFIX}{_stamp()}{snapshot.SUFFIX}"
        with sync.connect(url, autocommit=True) as conn:
            snapshot.write(conn, self.roots(), path, self._on_step)
        for older in self.folder.glob(f"{PREFIX}*"):  # one snapshot kept: the newest
            if older != path and _EXPORT_NAME.fullmatch(older.name):
                older.unlink(missing_ok=True)
        logger.info("Snapshot made", extra={"path": str(path)})

    # -- restoring ----------------------------------------------------------------------

    def begin_restore(self, *, backup: bool) -> Path:
        """Hold every other operation off and say where the upload goes. Raises
        `ConflictError` (nothing held) when a restore cannot run now, before any upload."""
        self.exclusive.claim("A restore")
        try:
            if backup and not sync.can_back_up():
                raise ConflictError("pg_dump is not installed, so no backup can be made.")
            with sync.connect(self._url(), autocommit=True) as conn:
                row = conn.execute("select count(*) from jobs where state = 'running'").fetchone()
            if row and row[0]:
                raise ConflictError(
                    f"{row[0]} job(s) are running. Restore once they finish, so none is lost "
                    "halfway."
                )
        except psycopg.Error as exc:
            self.exclusive.release()
            raise ConflictError(f"The database cannot be reached: {_reason(exc)}") from exc
        except Exception:
            self.exclusive.release()
            raise
        self.folder.mkdir(parents=True, exist_ok=True)
        return self.folder / f"upload-{_stamp()}{snapshot.SUFFIX}"

    def abandon_restore(self, upload: Path) -> None:
        """The upload did not arrive: let go of it and of the hold."""
        upload.unlink(missing_ok=True)
        self.exclusive.release()

    def start_restore(self, upload: Path, *, backup: bool) -> SnapshotProgress:
        """Restore the uploaded snapshot on a thread (after `begin_restore`)."""
        return self._start("restore", lambda: self._restore(upload, backup))

    def _restore(self, upload: Path, backup: bool) -> None:
        unpacked = upload.with_name(upload.name.removesuffix(snapshot.SUFFIX) + "-files")
        url = url_for(self.settings, self._target())
        runners = self._runners()
        stopped = False
        try:
            manifest = snapshot.unpack(upload, unpacked, self._on_step)
            upload.unlink(missing_ok=True)  # the unpacked copy is all that is needed now
            with sync.connect(url, autocommit=True) as conn:
                problems = snapshot.schema_problems(manifest, conn)
            if problems:
                raise snapshot.SnapshotError(
                    "The snapshot was made with a different schema (apply the same migrations "
                    "on both installs): " + "; ".join(problems)
                )
            if backup:
                self._update(step="Backing up the database", done=0, total=0)
                path = self.settings.database_backups_dir / f"before-restore-{_stamp()}.dump"
                self._update(backup_path=str(sync.back_up(url, path)))
            if runners is not None:  # nothing may write into the database being replaced
                runners.stop()
                stopped = True

            def on_table(table: str, index: int, total: int) -> None:
                self._update(step=f"Restoring {table}", done=index, total=total)

            with sync.connect(url, autocommit=True) as conn:
                copied = snapshot.load(conn, unpacked, manifest, on_table)
            self._update(rows=sum(copied.values()), step="Moving the files in")
            kept = self.folder / KEPT
            snapshot.swap_in(unpacked, self.roots(), kept)
            self._update(kept_path=str(kept), reindex_job=self._after_restore())
            logger.info("Snapshot restored", extra={"rows": sum(copied.values())})
        finally:
            shutil.rmtree(unpacked, ignore_errors=True)
            upload.unlink(missing_ok=True)
            if stopped and runners is not None:
                runners.start()

    def _after_restore(self) -> uuid.UUID | None:
        """Hand back jobs the snapshot caught mid-run, and rebuild the search index."""
        with Session(db_session.get_engine()) as session:
            running = session.exec(select(Job.id).where(col(Job.state) == JobState.RUNNING)).all()
            queue.release(session, list(running))
            job = queue.enqueue(session, JobSpec(kind=JobKind.EMBED))
            return job.id if job else None

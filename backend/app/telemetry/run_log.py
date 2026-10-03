"""Run logs: what a job did, as it happened, one JSON line per event.

    with run_log.job_log(job.id, attempt=job.attempts):   # the worker, around a job
        run_log.event("call", call=1, tier="distil")       # any layer below it
        run_log.text("text", chunk)                         # live model output

The worker opens a job's log around its handler (`app.jobs.worker`); the log is the
current one for that thread (a context variable), so the telemetry recorder (each model
call: its prompt and its reply), the CLI runner (the model's output streaming in, tool use,
rate-limit warnings) and the schema gate (a rejected reply) add to it without being handed
anything. Outside a job nothing is current and every call is a no-op.

One file per job under `run_logs_dir`, appended over all its attempts, so the API (or any
process on the machine) can tail it while the worker writes: `read` returns the events
after a byte offset and the offset to ask from next. Text arrives in tiny deltas and is
coalesced into one line per `_FLUSH_SECONDS`. A file stops growing at `MAX_BYTES` (with one
line saying so), and `prune` deletes logs older than `run_log_days`. Writing a log never
fails a job: an I/O error is logged once and the log goes quiet.
"""

import json
import logging
import threading
import time
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import IO, Any

from app.core.config import get_settings

logger = logging.getLogger(__name__)

MAX_BYTES = 4_000_000
# Prompts are whole chapters at times: enough to see what was asked, not a second copy.
PROMPT_CHARS = 60_000
REPLY_CHARS = 200_000
_FLUSH_SECONDS = 0.4
_READ_BYTES = 512_000
_FULL = "The log is full; later events are not kept."


def log_path(job_id: uuid.UUID, directory: Path | None = None) -> Path:
    return (directory or get_settings().run_logs_dir) / f"{job_id}.jsonl"


def clip(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return f"{text[:limit]}\n… [{len(text) - limit} more characters]"


class RunLog:
    """One job attempt's writer. Thread-safe: the CLI's stderr drains on its own thread."""

    def __init__(self, path: Path, *, attempt: int) -> None:
        self._path = path
        self._attempt = attempt
        self._lock = threading.Lock()
        self._file: IO[bytes] | None = None
        self._size = 0
        self._full = False
        self._broken = False
        self._pending: tuple[str, list[str]] | None = None
        self._pending_since = 0.0

    def event(self, kind: str, /, **fields: Any) -> None:
        with self._lock:
            self._flush_text()
            self._write({"type": kind, **fields})

    def text(self, kind: str, chunk: str) -> None:
        """Model output arriving in pieces: one line per kind and `_FLUSH_SECONDS`."""
        if not chunk:
            return
        with self._lock:
            if self._pending and self._pending[0] != kind:
                self._flush_text()
            if self._pending is None:
                self._pending, self._pending_since = (kind, []), time.monotonic()
            self._pending[1].append(chunk)
            if time.monotonic() - self._pending_since >= _FLUSH_SECONDS:
                self._flush_text()

    def close(self) -> None:
        with self._lock:
            self._flush_text()
            if self._file is not None:
                self._file.close()
                self._file = None

    def _flush_text(self) -> None:
        if self._pending is None:
            return
        kind, chunks = self._pending
        self._pending = None
        self._write({"type": kind, "text": "".join(chunks)})

    def _write(self, record: dict[str, Any]) -> None:
        if self._broken or self._full:
            return
        stamped = {"at": datetime.now(UTC).isoformat(), "attempt": self._attempt, **record}
        line = (json.dumps(stamped, ensure_ascii=False, default=str) + "\n").encode("utf-8")
        try:
            if self._file is None:
                self._path.parent.mkdir(parents=True, exist_ok=True)
                self._file = self._path.open("ab")
                self._size = self._path.stat().st_size
            if self._size + len(line) > MAX_BYTES:
                self._full = True
                full = {**stamped, "type": "truncated", "text": _FULL}
                line = (json.dumps(full) + "\n").encode("utf-8")
            self._file.write(line)
            self._file.flush()
            self._size += len(line)
        except OSError:
            self._broken = True
            logger.warning("Run log not written", extra={"path": str(self._path)}, exc_info=True)


_current: ContextVar[RunLog | None] = ContextVar("run_log", default=None)


@contextmanager
def job_log(job_id: uuid.UUID, *, attempt: int, directory: Path | None = None) -> Iterator[RunLog]:
    """Make a job's log the current one for this thread while the block runs."""
    log = RunLog(log_path(job_id, directory), attempt=max(attempt, 1))
    token = _current.set(log)
    try:
        yield log
    finally:
        _current.reset(token)
        log.close()


def event(kind: str, /, **fields: Any) -> None:
    """Add an event to the current job's log; nothing outside a job."""
    if (log := _current.get()) is not None:
        log.event(kind, **fields)


def text(kind: str, chunk: str) -> None:
    """Add model output (`text`, `thinking`) to the current job's log, coalesced."""
    if (log := _current.get()) is not None:
        log.text(kind, chunk)


def read(
    job_id: uuid.UUID, *, after: int = 0, directory: Path | None = None
) -> tuple[list[dict[str, Any]], int]:
    """The events written after byte `after`, and the offset to read from next. A line
    still being written is left for the next read. A missing log reads as empty."""
    path = log_path(job_id, directory)
    try:
        with path.open("rb") as handle:
            handle.seek(max(after, 0))
            chunk = handle.read(_READ_BYTES)
    except FileNotFoundError:
        return [], 0
    end = chunk.rfind(b"\n") + 1
    events = []
    for line in chunk[:end].splitlines():
        try:
            events.append(json.loads(line))
        except ValueError:
            continue
    return events, max(after, 0) + end


def prune(*, older_than: timedelta | None = None, directory: Path | None = None) -> int:
    """Delete logs not written to for `older_than` (`run_log_days`). Returns how many."""
    settings = get_settings()
    root = directory or settings.run_logs_dir
    cutoff = time.time() - (older_than or timedelta(days=settings.run_log_days)).total_seconds()
    removed = 0
    for path in root.glob("*.jsonl") if root.is_dir() else ():
        try:
            if path.stat().st_mtime < cutoff:
                path.unlink()
                removed += 1
        except OSError:
            continue
    return removed

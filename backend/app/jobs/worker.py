"""The worker loop: claim jobs, run their handlers in parallel, advance the pipeline.

    uv run python -m app.jobs.worker            # poll forever (SIGINT/SIGTERM to stop)
    uv run python -m app.jobs.worker --once     # drain what is runnable now, then exit
    uv run python -m app.jobs.worker --kinds parse,summarize --exclude-kinds brief

Handlers register themselves on import; the worker imports every module under
`app.pipeline.handlers`, then claims only the kinds that have a handler, so work for a
stage nobody implements yet simply waits in the queue. Each job runs in its own thread
and Session (the real work is a `claude -p` subprocess, so threads are enough), and a
heartbeat renews its lock while it runs: a job may outlive `queue.STALE_AFTER` (several
long CLI runs), and only a dead worker's job may be reclaimed. The
worker owns state transitions: success → `complete`, `PermanentJobError` → `failed`,
anything else → retry with backoff. Then the orchestrator decides what comes next.

A `UsageLimitError` (the account's usage limit: every run fails until it resets) pauses
the whole queue for every worker (`app_settings.pause_queue`, reason shown in the
pipeline view) and hands the job back unchanged (`queue.hold`): no attempt is spent and
nothing new starts until someone resumes. Jobs already running finish; one that hits the
limit too is held the same way.

While it runs, the worker keeps a row in `workers` fresh (`app.jobs.presence`), so the API
can say whether queued work will be picked up at all. The API runs one of these itself
(`app.jobs.background`); `abandon()` is how it stops mid-job on a reload: the jobs go back
to the queue and their `claude` runs are killed rather than waited for.

Embedded Qdrant (no `BOOKSHELF_QDRANT_URL`) locks its directory to one process, and the
API needs it for search, so the API owns it: its lifespan runs `embed` jobs in-process
(`app.jobs.embedded`) and this worker leaves them alone unless `--kinds embed` asks.
"""

import argparse
import importlib
import logging
import os
import pkgutil
import signal
import socket
import threading
import time
import uuid
from collections.abc import Callable, Collection, Mapping, Sequence
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from types import FrameType

from sqlalchemy.exc import SQLAlchemyError
from sqlmodel import Session

from app.core.config import get_settings
from app.core.logging import configure_logging
from app.jobs import presence, queue
from app.jobs.registry import (
    Handler,
    HandlerResult,
    JobContext,
    PermanentJobError,
    get_handler,
    registered_kinds,
)
from app.models import Job
from app.models.enums import JobKind, JobState
from app.pipeline.runner import UsageLimitError

logger = logging.getLogger("app.jobs.worker")

HANDLER_PACKAGE = "app.pipeline.handlers"
SessionFactory = Callable[[], Session]
OnDone = Callable[[Session, Job], object]


def autodiscover(package: str = HANDLER_PACKAGE) -> list[str]:
    """Import every module of `package` so its `@handler` registrations run."""
    root = importlib.import_module(package)
    names = [info.name for info in pkgutil.walk_packages(root.__path__, prefix=f"{package}.")]
    for name in names:
        importlib.import_module(name)
    return names


def default_session() -> Session:
    from app.db.session import engine

    return Session(engine)


def default_on_done(session: Session, job: Job) -> object:
    from app.pipeline import orchestrator

    return orchestrator.on_job_done(session, job)


class Worker:
    def __init__(
        self,
        *,
        concurrency: int | None = None,
        poll_seconds: float | None = None,
        handlers: Mapping[JobKind, Handler] | None = None,
        session_factory: SessionFactory = default_session,
        on_done: OnDone = default_on_done,
        only: Collection[JobKind] | None = None,
        exclude: Collection[JobKind] = (),
        heartbeat_seconds: float | None = None,
        label: str = "worker",
    ) -> None:
        settings = get_settings()
        self.concurrency = concurrency or settings.worker_concurrency
        self.poll_seconds = poll_seconds or settings.worker_poll_seconds
        self._handlers = handlers
        self._session_factory = session_factory
        self._on_done = on_done
        self._only = frozenset(only) if only is not None else None
        self._exclude = frozenset(exclude)
        self.heartbeat_seconds = heartbeat_seconds or queue.HEARTBEAT_SECONDS
        self.stop = threading.Event()
        self.id = uuid.uuid4()
        self.name = f"{label} {socket.gethostname()}:{os.getpid()}"
        self._lock = threading.Lock()
        self._held: set[uuid.UUID] = set()  # claimed and not yet recorded
        self._released: set[uuid.UUID] = set()  # handed back by `abandon()`: never record
        self._last_seen = 0.0

    # -- handler lookup -------------------------------------------------------------

    def kinds(self) -> list[JobKind]:
        """The kinds this worker claims: those with a handler, narrowed by `only`/`exclude`."""
        handled = sorted(self._handlers) if self._handlers is not None else registered_kinds()
        return [
            kind
            for kind in handled
            if (self._only is None or kind in self._only) and kind not in self._exclude
        ]

    def handler_for(self, kind: JobKind) -> Handler | None:
        return self._handlers.get(kind) if self._handlers is not None else get_handler(kind)

    # -- one job ---------------------------------------------------------------------

    def claim(self) -> Job | None:
        kinds = self.kinds()
        if not kinds:
            return None
        with self._session_factory() as session:
            job = queue.claim(session, kinds)
            if job is not None and self.stop.is_set():  # claimed while `abandon()` ran
                queue.release(session, [job.id])
                return None
            if job is not None:
                session.expunge(job)
                with self._lock:
                    self._held.add(job.id)
            return job

    def release_held(self) -> int:
        """Claim nothing more and put every held job back in the queue, marked released so
        its handler's outcome is not recorded. Kills nothing: when several workers share
        the process, all of them release first (`app.main` lifespan), so killing one's
        subprocesses never lands as a failure on another's job. Returns how many went back."""
        self.stop.set()
        with self._lock:
            held = list(self._held)
            self._released.update(held)
        with self._session_factory() as session:
            released = queue.release(session, held)
        if released:
            logger.info("Handed running jobs back to the queue", extra={"jobs": released})
        return released

    def abandon(self) -> int:
        """Stop now: `release_held`, then kill the `claude` (and speech model) runs working
        on the jobs. Returns how many jobs went back."""
        from app.pipeline.runner import terminate_all

        released = self.release_held()
        terminate_all()
        return released

    def _is_released(self, job_id: uuid.UUID) -> bool:
        with self._lock:
            return job_id in self._released

    # -- presence ---------------------------------------------------------------------

    def beat(self, *, force: bool = False) -> None:
        """Refresh this worker's `workers` row, at most every `presence.BEAT_SECONDS`."""
        now = time.monotonic()
        if not force and now - self._last_seen < presence.BEAT_SECONDS:
            return
        self._last_seen = now
        with self._lock:
            running = len(self._held)
        try:
            with self._session_factory() as session:
                presence.beat(session, self.id, name=self.name, kinds=self.kinds(),
                              concurrency=self.concurrency, running=running)  # fmt: skip
        except Exception:  # presence is advisory: never stop the loop over it
            logger.warning("Worker presence update failed", exc_info=True)

    def _leave(self) -> None:
        try:
            with self._session_factory() as session:
                presence.leave(session, self.id)
        except Exception:
            logger.warning("Worker presence removal failed", exc_info=True)

    def _beat(self, job_id: uuid.UUID, done: threading.Event) -> None:
        """Renew the job's lock until `done` is set (own session: never the job's)."""
        while not done.wait(self.heartbeat_seconds):
            try:
                with self._session_factory() as session:
                    if not queue.heartbeat(session, job_id):
                        return
            except Exception:  # a missed beat is harmless; the next one retries
                logger.warning("Job heartbeat failed", extra={"job_id": str(job_id)}, exc_info=True)

    def execute(self, job: Job) -> JobState:
        """Run one claimed job to its next state, in a fresh session, renewing its lock."""
        done = threading.Event()
        beat = threading.Thread(
            target=self._beat, args=(job.id, done), name=f"heartbeat-{job.id}", daemon=True
        )
        beat.start()
        try:
            return self._execute(job)
        finally:
            done.set()
            beat.join()
            with self._lock:
                self._held.discard(job.id)

    def _execute(self, job: Job) -> JobState:
        with self._session_factory() as session:
            job = session.merge(job, load=True)
            handler = self.handler_for(job.kind)
            extra = {"job_id": str(job.id), "kind": job.kind.value, "anchor": job.anchor}
            outcome: HandlerResult | None = None
            error: Exception | None = None
            try:
                if handler is None:
                    raise PermanentJobError(f"no handler registered for {job.kind.value}")
                outcome = handler(JobContext(session=session, job=job))
            except Exception as exc:
                session.rollback()
                error = exc
            if self._is_released(job.id):  # abandoned mid-run: the queue already has it back
                session.rollback()
                return JobState.QUEUED
            if isinstance(error, UsageLimitError):
                self._pause_for_limit(session, job, error)
                return job.state
            if isinstance(error, PermanentJobError):
                queue.fail(session, job, str(error), retry=False)
                logger.warning("Job failed permanently", extra={**extra, "error": str(error)})
            elif error is not None:
                queue.fail(session, job, f"{type(error).__name__}: {error}")
                logger.error(
                    "Job failed", extra={**extra, "attempts": job.attempts}, exc_info=error
                )
            elif outcome is not None:
                queue.complete(
                    session,
                    job,
                    state=outcome.state,
                    result=outcome.result,
                    cost_tokens=outcome.cost_tokens,
                )
                logger.info(
                    "Job finished",
                    extra={**extra, "state": job.state.value, "duration_ms": job.duration_ms},
                )
            if job.state in (JobState.DONE, JobState.SKIPPED, JobState.FAILED):
                try:
                    self._on_done(session, job)
                except Exception:
                    session.rollback()
                    logger.exception("Orchestrator failed after job", extra=extra)
            return job.state

    def _pause_for_limit(self, session: Session, job: Job, error: UsageLimitError) -> None:
        from app.services.app_settings import pause_queue

        pause_queue(session, str(error))
        queue.hold(session, job, str(error))
        logger.warning(
            "Usage limit reached: queue paused",
            extra={"job_id": str(job.id), "kind": job.kind.value, "error": str(error)},
        )

    # -- loops -------------------------------------------------------------------------

    def run(self, *, once: bool = False) -> int:
        """Claim and run jobs until stopped (or, with `once`, until nothing is runnable).

        Returns the number of jobs processed.
        """
        self._prune_and_join()
        try:
            return self._loop(once=once)
        finally:
            self._leave()

    def _prune_and_join(self) -> None:
        try:
            with self._session_factory() as session:
                presence.prune(session)
        except Exception:
            logger.warning("Worker presence prune failed", exc_info=True)
        self.beat(force=True)

    def _loop(self, *, once: bool) -> int:
        processed = 0
        with ThreadPoolExecutor(self.concurrency, thread_name_prefix="job") as pool:
            running: set[Future[JobState]] = set()
            while not self.stop.is_set():
                self.beat()
                try:
                    job = self.claim() if len(running) < self.concurrency else None
                except SQLAlchemyError:
                    # A dropped connection (network change, laptop sleep) must not end the
                    # loop: the thread would be gone until a restart. Wait a poll, retry.
                    if once:
                        raise
                    logger.warning("Claiming a job failed; retrying", exc_info=True)
                    job = None
                if job is not None:
                    running.add(pool.submit(self.execute, job))
                    continue
                if running:  # full, or idle while jobs run: wait for one to finish
                    done, running = wait(
                        running, timeout=self.poll_seconds, return_when=FIRST_COMPLETED
                    )
                    processed += len(done)
                    continue
                if once:  # nothing running and nothing claimable: drained
                    break
                self.stop.wait(self.poll_seconds)
            done, _ = wait(running)
            processed += len(done)
        return processed


def _install_signal_handlers(worker: Worker) -> None:
    def stop(signum: int, _frame: FrameType | None) -> None:
        logger.info("Stopping after running jobs finish", extra={"signal": signum})
        worker.stop.set()

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)


def parse_kinds(value: str) -> list[JobKind]:
    try:
        return [JobKind(item.strip()) for item in value.split(",") if item.strip()]
    except ValueError as exc:
        choices = ", ".join(k.value for k in JobKind)
        raise argparse.ArgumentTypeError(f"{exc}; choose from {choices}") from None


def kind_filters(
    only: list[JobKind] | None, exclude: list[JobKind], *, qdrant_embedded: bool
) -> tuple[list[JobKind] | None, list[JobKind]]:
    """The CLI's `(only, exclude)`, plus `embed` excluded when the API owns embedded Qdrant,
    and `narrate`, which the API runs one at a time (`app.jobs.narration`).

    An explicit `--kinds embed` (or `narrate`) wins: e.g. a one-off rebuild while the API
    is down.
    """
    if JobKind.NARRATE not in (only or []) and JobKind.NARRATE not in exclude:
        exclude = [*exclude, JobKind.NARRATE]
    if qdrant_embedded and JobKind.EMBED not in (only or []) and JobKind.EMBED not in exclude:
        exclude = [*exclude, JobKind.EMBED]
        logger.warning(
            "Skipping embed jobs: Qdrant is embedded (BOOKSHELF_QDRANT_URL unset) and its "
            "directory lock belongs to the API, which runs embed jobs itself. Set "
            "BOOKSHELF_QDRANT_URL to a server to embed here, or pass --kinds embed."
        )
    return only, exclude


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.jobs.worker", description=__doc__)
    parser.add_argument("--once", action="store_true", help="drain runnable jobs, then exit")
    parser.add_argument("--concurrency", type=int, default=None, help="parallel jobs")
    parser.add_argument(
        "--kinds", type=parse_kinds, default=None, help="only these job kinds (comma-separated)"
    )
    parser.add_argument(
        "--exclude-kinds", type=parse_kinds, default=[], help="never these job kinds"
    )
    args = parser.parse_args(argv)

    settings = get_settings()
    configure_logging(settings.log_level, json_output=settings.log_json)
    modules = autodiscover()
    only, exclude = kind_filters(
        args.kinds, args.exclude_kinds, qdrant_embedded=settings.qdrant_url is None
    )
    worker = Worker(concurrency=args.concurrency, only=only, exclude=exclude)
    _install_signal_handlers(worker)
    logger.info(
        "Worker started",
        extra={
            "kinds": [k.value for k in worker.kinds()],
            "handler_modules": modules,
            "concurrency": worker.concurrency,
            "once": args.once,
        },
    )
    processed = worker.run(once=args.once)
    logger.info("Worker stopped", extra={"processed": processed})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

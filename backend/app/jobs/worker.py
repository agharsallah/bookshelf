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

Embedded Qdrant (no `BOOKSHELF_QDRANT_URL`) locks its directory to one process, and the
API needs it for search, so the API owns it: its lifespan runs `embed` jobs in-process
(`app.jobs.embedded`) and this worker leaves them alone unless `--kinds embed` asks.
"""

import argparse
import importlib
import logging
import pkgutil
import signal
import threading
import uuid
from collections.abc import Callable, Collection, Mapping, Sequence
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from types import FrameType

from sqlmodel import Session

from app.core.config import get_settings
from app.core.logging import configure_logging
from app.jobs import queue
from app.jobs.registry import Handler, JobContext, PermanentJobError, get_handler, registered_kinds
from app.models import Job
from app.models.enums import JobKind, JobState

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
            if job is not None:
                session.expunge(job)
            return job

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

    def _execute(self, job: Job) -> JobState:
        with self._session_factory() as session:
            job = session.merge(job, load=True)
            handler = self.handler_for(job.kind)
            extra = {"job_id": str(job.id), "kind": job.kind.value, "anchor": job.anchor}
            try:
                if handler is None:
                    raise PermanentJobError(f"no handler registered for {job.kind.value}")
                outcome = handler(JobContext(session=session, job=job))
            except PermanentJobError as exc:
                session.rollback()
                queue.fail(session, job, str(exc), retry=False)
                logger.warning("Job failed permanently", extra={**extra, "error": str(exc)})
            except Exception as exc:
                session.rollback()
                queue.fail(session, job, f"{type(exc).__name__}: {exc}")
                logger.exception("Job failed", extra={**extra, "attempts": job.attempts})
            else:
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

    # -- loops -------------------------------------------------------------------------

    def run(self, *, once: bool = False) -> int:
        """Claim and run jobs until stopped (or, with `once`, until nothing is runnable).

        Returns the number of jobs processed.
        """
        processed = 0
        with ThreadPoolExecutor(self.concurrency, thread_name_prefix="job") as pool:
            running: set[Future[JobState]] = set()
            while not self.stop.is_set():
                job = self.claim() if len(running) < self.concurrency else None
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
    """The CLI's `(only, exclude)`, plus `embed` excluded when the API owns embedded Qdrant.

    An explicit `--kinds embed` wins: e.g. a one-off rebuild while the API is down.
    """
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

"""The worker loop: claim jobs, run their handlers in parallel, advance the pipeline.

    uv run python -m app.jobs.worker            # poll forever (SIGINT/SIGTERM to stop)
    uv run python -m app.jobs.worker --once     # drain what is runnable now, then exit

Handlers register themselves on import; the worker imports every module under
`app.pipeline.handlers`, then claims only the kinds that have a handler, so work for a
stage nobody implements yet simply waits in the queue. Each job runs in its own thread
and Session (the real work is a `claude -p` subprocess, so threads are enough). The
worker owns state transitions: success → `complete`, `PermanentJobError` → `failed`,
anything else → retry with backoff. Then the orchestrator decides what comes next.
"""

import argparse
import importlib
import logging
import pkgutil
import signal
import threading
from collections.abc import Callable, Mapping, Sequence
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


def _default_session() -> Session:
    from app.db.session import engine

    return Session(engine)


def _default_on_done(session: Session, job: Job) -> object:
    from app.pipeline import orchestrator

    return orchestrator.on_job_done(session, job)


class Worker:
    def __init__(
        self,
        *,
        concurrency: int | None = None,
        poll_seconds: float | None = None,
        handlers: Mapping[JobKind, Handler] | None = None,
        session_factory: SessionFactory = _default_session,
        on_done: OnDone = _default_on_done,
    ) -> None:
        settings = get_settings()
        self.concurrency = concurrency or settings.worker_concurrency
        self.poll_seconds = poll_seconds or settings.worker_poll_seconds
        self._handlers = handlers
        self._session_factory = session_factory
        self._on_done = on_done
        self.stop = threading.Event()

    # -- handler lookup -------------------------------------------------------------

    def kinds(self) -> list[JobKind]:
        return sorted(self._handlers) if self._handlers is not None else registered_kinds()

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

    def execute(self, job: Job) -> JobState:
        """Run one claimed job to its next state, in a fresh session."""
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


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.jobs.worker", description=__doc__)
    parser.add_argument("--once", action="store_true", help="drain runnable jobs, then exit")
    parser.add_argument("--concurrency", type=int, default=None, help="parallel jobs")
    args = parser.parse_args(argv)

    settings = get_settings()
    configure_logging(settings.log_level, json_output=settings.log_json)
    modules = autodiscover()
    worker = Worker(concurrency=args.concurrency)
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

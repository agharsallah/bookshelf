"""Workers the API runs on a background thread (`app.main` lifespan).

Before this, pipeline jobs ran only in a separate `python -m app.jobs.worker` process;
forget to start it and every job waited in `queued` forever. Now the API runs a worker
itself (`BOOKSHELF_API_WORKER`, on by default), so starting the API is enough. A standalone
worker can still run beside it: `claim()` uses `SKIP LOCKED`, so they share the queue.

The same wrapper runs the embedded-Qdrant `embed` runner (`app.jobs.embedded`).

Stopping (`fastapi dev` reloads on every save) must not wait for a model run that takes
minutes: `stop()` abandons the worker's jobs — back to the queue, `claude` killed — so the
next process starts them again at once instead of after `queue.STALE_AFTER`.
"""

import logging
import threading

from app.jobs.worker import Worker

logger = logging.getLogger(__name__)

JOIN_SECONDS = 10.0


class BackgroundWorker:
    """One daemon thread running `worker.run()` until `stop()`."""

    def __init__(self, worker: Worker, *, name: str) -> None:
        self.worker = worker
        self._name = name
        self._thread: threading.Thread | None = None

    @property
    def running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def start(self) -> None:
        if self.running:
            return
        self.worker.stop.clear()
        self._thread = threading.Thread(target=self._run, name=self._name, daemon=True)
        self._thread.start()
        logger.info("Background worker started", extra={"worker": self._name,
                    "kinds": [k.value for k in self.worker.kinds()]})  # fmt: skip

    def _run(self) -> None:
        try:
            self.worker.run()
        except Exception:  # never take the API down; each job's outcome is already recorded
            logger.exception("Background worker stopped unexpectedly", extra={"worker": self._name})

    def stop(self, timeout: float = JOIN_SECONDS, *, abandon: bool = False) -> bool:
        """Stop the loop; with `abandon`, hand running jobs back instead of finishing them.
        True when the thread has stopped within `timeout`."""
        if abandon:
            try:
                self.worker.abandon()
            except Exception:  # the jobs will go stale and be reclaimed instead
                logger.exception("Could not hand jobs back", extra={"worker": self._name})
        self.worker.stop.set()
        if self._thread is None:
            return True
        self._thread.join(timeout)
        stopped = not self._thread.is_alive()
        if not stopped:
            logger.warning("%s still busy after %.0fs; leaving it to exit", self._name, timeout)
        return stopped

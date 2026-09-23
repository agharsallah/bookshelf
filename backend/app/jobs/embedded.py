"""The API's in-process `embed` runner, for embedded Qdrant (§18 "API-owned Qdrant").

The embedded store (`BOOKSHELF_QDRANT_URL` unset) holds an exclusive lock on its
directory, so exactly one process may open it. Search lives in the API, so the API owns
the store: its lifespan starts this runner, which claims only `embed` jobs, one at a time,
on one background thread, with the same `Worker` machinery (state transitions, retries,
orchestrator) as the standalone worker. The standalone worker skips `embed` in this mode.

With a Qdrant URL configured, the lifespan does not start it and the worker embeds.
Nothing here opens Qdrant: the embed handler does, on the first job.
"""

import logging
import threading
from collections.abc import Mapping

from app.jobs.registry import Handler
from app.jobs.worker import OnDone, SessionFactory, Worker, default_on_done, default_session
from app.models.enums import JobKind

logger = logging.getLogger(__name__)

JOIN_SECONDS = 10.0


def _embed_handlers() -> dict[JobKind, Handler]:
    from app.pipeline.handlers.embed import run_embed

    return {JobKind.EMBED: run_embed}


class EmbedRunner:
    """One daemon thread running a single-slot `Worker` restricted to `embed`."""

    def __init__(
        self,
        *,
        poll_seconds: float | None = None,
        handlers: Mapping[JobKind, Handler] | None = None,
        session_factory: SessionFactory = default_session,
        on_done: OnDone = default_on_done,
    ) -> None:
        self.worker = Worker(
            concurrency=1,
            poll_seconds=poll_seconds,
            handlers=handlers if handlers is not None else _embed_handlers(),
            session_factory=session_factory,
            on_done=on_done,
            only=[JobKind.EMBED],
        )
        self._thread: threading.Thread | None = None

    @property
    def running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def start(self) -> None:
        if self.running:
            return
        self.worker.stop.clear()
        self._thread = threading.Thread(target=self._run, name="embed-runner", daemon=True)
        self._thread.start()
        logger.info("Embed runner started (embedded Qdrant is owned by the API)")

    def _run(self) -> None:
        try:
            self.worker.run()
        except Exception:  # never take the API down; the job itself was already recorded
            logger.exception("Embed runner stopped unexpectedly")

    def stop(self, timeout: float = JOIN_SECONDS) -> bool:
        """Ask the loop to stop and wait for a running embed to finish. True when stopped."""
        self.worker.stop.set()
        if self._thread is None:
            return True
        self._thread.join(timeout)
        stopped = not self._thread.is_alive()
        if not stopped:
            logger.warning("Embed runner still busy after %.0fs; leaving it to exit", timeout)
        return stopped

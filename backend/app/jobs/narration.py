"""The API's in-process `narrate` runner: one narration at a time.

A narration loads the whole speech model (gigabytes, on the GPU when there is one) for as
long as it runs, so two at once would starve each other, and the pipeline worker's
concurrency is sized for `claude` runs, not for that. The lifespan starts this single-slot
worker for `narrate` only (`BOOKSHELF_API_NARRATE_RUNNER`, on by default); the pipeline
workers leave `narrate` alone unless `--kinds narrate` asks.
"""

from collections.abc import Mapping

from app.jobs.background import BackgroundWorker
from app.jobs.registry import Handler
from app.jobs.worker import OnDone, SessionFactory, Worker, default_on_done, default_session
from app.models.enums import JobKind


def _narrate_handlers() -> dict[JobKind, Handler]:
    from app.pipeline.handlers.narrate import run_narrate

    return {JobKind.NARRATE: run_narrate}


class NarrateRunner(BackgroundWorker):
    """One daemon thread running a single-slot `Worker` restricted to `narrate`."""

    def __init__(
        self,
        *,
        poll_seconds: float | None = None,
        handlers: Mapping[JobKind, Handler] | None = None,
        session_factory: SessionFactory = default_session,
        on_done: OnDone = default_on_done,
    ) -> None:
        worker = Worker(
            concurrency=1,
            poll_seconds=poll_seconds,
            handlers=handlers if handlers is not None else _narrate_handlers(),
            session_factory=session_factory,
            on_done=on_done,
            only=[JobKind.NARRATE],
            label="api-narrate",
        )
        super().__init__(worker, name="narrate-runner")

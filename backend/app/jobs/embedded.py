"""The API's in-process `embed` runner, for embedded Qdrant (§18 "API-owned Qdrant").

The embedded store (`BOOKSHELF_QDRANT_URL` unset) holds an exclusive lock on its
directory, so exactly one process may open it. Search lives in the API, so the API owns
the store: its lifespan starts this runner, which claims only `embed` jobs, one at a time,
on one background thread, with the same `Worker` machinery (state transitions, retries,
orchestrator) as the standalone worker. The standalone worker skips `embed` in this mode.

With a Qdrant URL configured, the lifespan does not start it and the worker embeds.
Nothing here opens Qdrant: the embed handler does, on the first job.
"""

from collections.abc import Mapping

from app.jobs.background import JOIN_SECONDS, BackgroundWorker
from app.jobs.registry import Handler
from app.jobs.worker import OnDone, SessionFactory, Worker, default_on_done, default_session
from app.models.enums import JobKind

__all__ = ["JOIN_SECONDS", "EmbedRunner"]


def _embed_handlers() -> dict[JobKind, Handler]:
    from app.pipeline.handlers.embed import run_embed

    return {JobKind.EMBED: run_embed}


class EmbedRunner(BackgroundWorker):
    """One daemon thread running a single-slot `Worker` restricted to `embed`."""

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
            handlers=handlers if handlers is not None else _embed_handlers(),
            session_factory=session_factory,
            on_done=on_done,
            only=[JobKind.EMBED],
            label="api-embed",
        )
        super().__init__(worker, name="embed-runner")

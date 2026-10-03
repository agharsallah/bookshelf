"""The API's in-process `build_run` runner: one build at a time.

A build run is one long `claude` agent process (up to `build_hard_cap_minutes`), watched
for its whole life. On a pipeline slot it would hold a skill CLI slot for hours, so the
lifespan starts this single-slot worker for `build_run` only (`BOOKSHELF_API_BUILD_RUNNER`,
on by default) and the pipeline workers leave `build_run` alone.

Stopping the API hands the job back but never kills the agent: it runs detached
(`app.builds.process`), outside `terminate_all`, and the next claim attaches to it.
"""

from collections.abc import Mapping

from app.jobs.background import BackgroundWorker
from app.jobs.registry import Handler
from app.jobs.worker import OnDone, SessionFactory, Worker, default_on_done, default_session
from app.models.enums import JobKind


def _build_handlers() -> dict[JobKind, Handler]:
    from app.pipeline.handlers.builds_run import run_build_job

    return {JobKind.BUILD_RUN: run_build_job}


class BuildRunner(BackgroundWorker):
    """One daemon thread running a single-slot `Worker` restricted to `build_run`."""

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
            handlers=handlers if handlers is not None else _build_handlers(),
            session_factory=session_factory,
            on_done=on_done,
            only=[JobKind.BUILD_RUN],
            label="api-build",
        )
        super().__init__(worker, name="build-runner")

"""Job handler registry: each pipeline stage registers one handler per `JobKind`.

    @handler(JobKind.PARSE)
    def run_parse(ctx: JobContext) -> HandlerResult: ...

Handlers are plain functions. They receive a session and the claimed job, do their
work, and return a `HandlerResult`; the worker owns state transitions (complete / fail
/ retry), so a handler never touches `job.state` itself. Raise `PermanentJobError` for
failures that a retry cannot fix (bad input, schema violation after the retry budget).
"""

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from sqlmodel import Session

from app.models import Job
from app.models.enums import JobKind, JobState


class PermanentJobError(Exception):
    """A failure retrying cannot fix. The job goes straight to `failed`."""


@dataclass(slots=True)
class JobContext:
    session: Session
    job: Job


@dataclass(slots=True)
class HandlerResult:
    state: JobState = JobState.DONE
    result: dict[str, Any] = field(default_factory=dict)
    cost_tokens: int | None = None


Handler = Callable[[JobContext], HandlerResult]

_HANDLERS: dict[JobKind, Handler] = {}


def handler(kind: JobKind) -> Callable[[Handler], Handler]:
    def register(fn: Handler) -> Handler:
        if kind in _HANDLERS and _HANDLERS[kind] is not fn:
            raise RuntimeError(f"Handler for {kind} already registered: {_HANDLERS[kind]!r}")
        _HANDLERS[kind] = fn
        return fn

    return register


def get_handler(kind: JobKind) -> Handler | None:
    return _HANDLERS.get(kind)


def registered_kinds() -> list[JobKind]:
    return sorted(_HANDLERS)

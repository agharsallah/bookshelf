"""`build_run` job: an agent builds the approved plan in its own repo (docs/BUILDS.md §2).

The body is `app.builds.runner.run_build`. A setup failure retrying cannot fix (no `gh`
login, a taken repository name, no `claude`, a broken agent package) marks the build
`failed` with the message, and goes straight to `failed` (`PermanentJobError`): three
retries would only repeat it. Any other error also marks the build failed with what went
wrong, and its job fails for good: *Continue* is how you try again.

It runs on the build runner's own slot (`app.jobs.build_runner`), never a pipeline slot.
"""

import logging

from sqlmodel import Session

from app.builds import service
from app.builds.runner import run_build
from app.jobs.registry import HandlerResult, JobContext, PermanentJobError, handler
from app.models.build import BuildState, StopReason
from app.models.enums import JobKind

logger = logging.getLogger(__name__)


def _mark_failed(session: Session, ctx: JobContext, message: str) -> None:
    from app.builds.runner import build_id_of

    session.rollback()
    try:
        build = service.get_build(session, build_id_of(ctx))
        if build.state not in service.FINAL_STATES:
            service.finish(session, build, state=BuildState.FAILED, stop_reason=StopReason.ERROR,
                           error=message[:4000])  # fmt: skip
    except Exception:  # the job's own error still records what happened
        session.rollback()
        logger.exception("Could not mark the build failed", extra={"job_id": str(ctx.job.id)})


@handler(JobKind.BUILD_RUN)
def run_build_job(ctx: JobContext) -> HandlerResult:
    try:
        return run_build(ctx)
    except Exception as exc:
        message = str(exc) or type(exc).__name__
        _mark_failed(ctx.session, ctx, message)
        raise PermanentJobError(message) from exc

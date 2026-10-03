"""`build_plan` (docs/BUILDS.md B1): a build's plan from the plan-build utility skill, run
inline on the CLI runner and recorded per call (`app.builds.planning`)."""

from app.builds import planning
from app.jobs.registry import HandlerResult, JobContext, handler
from app.models.enums import JobKind


@handler(JobKind.BUILD_PLAN)
def run_build_plan(ctx: JobContext) -> HandlerResult:
    return planning.run_plan(ctx)

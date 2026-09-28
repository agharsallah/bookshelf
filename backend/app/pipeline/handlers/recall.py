"""`grade_recall` job: grade a closed-book recall (`app.recall.grading`) on the CLI runner,
recorded per call."""

from app.jobs.registry import HandlerResult, JobContext, handler
from app.models.enums import JobKind
from app.pipeline.handlers.skills import default_runner
from app.recall.grading import SKILL_NAME, run_grade_job
from app.telemetry.recorder import recorded


@handler(JobKind.GRADE_RECALL)
def run_grade_recall(ctx: JobContext) -> HandlerResult:
    runner = recorded(default_runner(), ctx.job, skill=SKILL_NAME)
    return run_grade_job(ctx.session, ctx.job, runner=runner)

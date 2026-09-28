"""`grade_recall` job: grade a closed-book recall (`app.recall.grading`), on the CLI runner."""

from app.jobs.registry import HandlerResult, JobContext, handler
from app.models.enums import JobKind
from app.pipeline.handlers.skills import default_runner
from app.recall.grading import run_grade_job


@handler(JobKind.GRADE_RECALL)
def run_grade_recall(ctx: JobContext) -> HandlerResult:
    return run_grade_job(ctx.session, ctx.job, runner=default_runner())

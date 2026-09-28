"""`relate_claims` job: judge cross-paper claim pairs (`app.papers.claim_pairs`) with the
relate-claims utility skill on the CLI runner, recorded per call."""

from app.jobs.registry import HandlerResult, JobContext, handler
from app.models.enums import JobKind
from app.papers.claim_pairs import SKILL_NAME, run_relate_job
from app.pipeline.handlers.skills import default_runner
from app.telemetry.recorder import recorded


@handler(JobKind.RELATE_CLAIMS)
def run_relate_claims(ctx: JobContext) -> HandlerResult:
    runner = recorded(default_runner(), ctx.job, skill=SKILL_NAME)
    return run_relate_job(ctx.session, ctx.job, runner=runner)

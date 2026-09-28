"""Paper jobs that run a utility skill over the whole shelf or a set (docs/PAPERS.md §4, §5):

    recommend_next     payload.candidate_ids → app.papers.recommend (reasons, never scores)
    synthesize_papers  payload.set_id        → app.papers.synthesis (versioned syntheses)

Both run on the CLI runner, recorded per call, like `grade_recall`. Registering
`recommend_next` here is what turns on `candidate_store.queue_recommend_next`.
"""

from app.jobs.registry import HandlerResult, JobContext, handler
from app.models.enums import JobKind
from app.papers import recommend, synthesis
from app.pipeline.handlers.skills import default_runner
from app.telemetry.recorder import recorded


@handler(JobKind.RECOMMEND_NEXT)
def run_recommend_next(ctx: JobContext) -> HandlerResult:
    runner = recorded(default_runner(), ctx.job, skill=recommend.SKILL_NAME)
    return recommend.run_recommend_job(ctx.session, ctx.job, runner=runner)


@handler(JobKind.SYNTHESIZE_PAPERS)
def run_synthesize_papers(ctx: JobContext) -> HandlerResult:
    runner = recorded(default_runner(), ctx.job, skill=synthesis.SKILL_NAME)
    return synthesis.run_synthesis_job(ctx.session, ctx.job, runner=runner)

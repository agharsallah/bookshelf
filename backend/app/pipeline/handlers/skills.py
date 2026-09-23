"""One generic handler for every skill-backed JobKind.

The job kind picks the skill through each package's `meta.yaml` `job_kind`; `derive` jobs
name theirs in `job.skill` or `payload.skill`. All the work is in
`app.pipeline.execution.execute_skill_job`; this module only binds it to the registry and
to the process-wide CLI runner. A `link_concepts` job in dedup mode proposes concept merges
instead (`app.graph.pipeline`).
"""

from app.graph.pipeline import is_dedup_job, run_dedup_job
from app.jobs.registry import HandlerResult, JobContext, handler
from app.pipeline.execution import SKILL_JOB_KINDS, execute_skill_job
from app.pipeline.runner import ClaudeCliRunner, ModelRunner

_runner: ModelRunner | None = None


def default_runner() -> ModelRunner:
    global _runner
    if _runner is None:
        _runner = ClaudeCliRunner()
    return _runner


def run_skill(ctx: JobContext) -> HandlerResult:
    if is_dedup_job(ctx.job):  # link_concepts with payload.mode = dedup (app.graph.pipeline)
        return run_dedup_job(ctx.session, ctx.job, runner=default_runner())
    return execute_skill_job(ctx.session, ctx.job, runner=default_runner())


for _kind in sorted(SKILL_JOB_KINDS):
    handler(_kind)(run_skill)

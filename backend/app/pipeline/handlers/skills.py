"""One generic handler for every skill-backed JobKind.

The job kind picks the skill through each package's `meta.yaml` `job_kind`; `derive` jobs
name theirs in `job.skill` or `payload.skill`. All the work is in
`app.pipeline.execution.execute_skill_job`; this module only binds it to the registry and
to the process-wide CLI runner.
"""

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
    return execute_skill_job(ctx.session, ctx.job, runner=default_runner())


for _kind in sorted(SKILL_JOB_KINDS):
    handler(_kind)(run_skill)

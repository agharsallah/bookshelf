"""One generic handler for every skill-backed JobKind.

The job kind picks the skill through each package's `meta.yaml` `job_kind`; `derive` jobs
name theirs in `job.skill` or `payload.skill`. All the work is in
`app.pipeline.execution.execute_skill_job`; this module only binds it to the registry and
to the process-wide CLI runner, recorded per call (`app.telemetry.recorder`). A
`link_concepts` job in dedup mode proposes concept merges instead, and in bridge mode
cross-book relations (`app.graph.pipeline`).
"""

from app.graph import bridges, dedup
from app.graph.pipeline import is_bridge_job, is_dedup_job, run_bridge_job, run_dedup_job
from app.jobs.registry import HandlerResult, JobContext, handler
from app.pipeline.execution import SKILL_JOB_KINDS, execute_skill_job
from app.pipeline.runner import ClaudeCliRunner, ModelRunner
from app.telemetry.recorder import recorded

_runner: ModelRunner | None = None


def default_runner() -> ModelRunner:
    global _runner
    if _runner is None:
        _runner = ClaudeCliRunner()
    return _runner


def run_skill(ctx: JobContext) -> HandlerResult:
    job = ctx.job
    if is_dedup_job(job):  # link_concepts with payload.mode = dedup (app.graph.pipeline)
        runner = recorded(default_runner(), job, skill=dedup.SKILL_NAME)
        return run_dedup_job(ctx.session, job, runner=runner)
    if is_bridge_job(job):  # link_concepts with payload.mode = bridge (app.graph.bridges)
        runner = recorded(default_runner(), job, skill=bridges.SKILL_NAME)
        return run_bridge_job(ctx.session, job, runner=runner)
    return execute_skill_job(ctx.session, job, runner=recorded(default_runner(), job))


for _kind in sorted(SKILL_JOB_KINDS):
    handler(_kind)(run_skill)

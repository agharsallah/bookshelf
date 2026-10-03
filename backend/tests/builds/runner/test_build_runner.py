from sqlmodel import Session, select

from app.core.config import get_settings
from app.jobs import queue
from app.jobs.build_runner import BuildRunner
from app.jobs.queue import JobSpec
from app.jobs.registry import HandlerResult
from app.jobs.runners import _job_worker
from app.models import Job
from app.models.enums import JobKind, JobState


def test_the_build_runner_claims_build_run_only_one_at_a_time(session: Session) -> None:
    queue.enqueue(session, JobSpec(kind=JobKind.BUILD_RUN, anchor="build"))
    queue.enqueue(session, JobSpec(kind=JobKind.EXPORT, anchor="bundle"))
    handlers = {k: lambda ctx: HandlerResult() for k in (JobKind.BUILD_RUN, JobKind.EXPORT)}
    runner = BuildRunner(poll_seconds=0.01, handlers=handlers, on_done=lambda s, j: None)

    assert runner.worker.run(once=True) == 1
    session.expire_all()
    states = {j.anchor: j.state for j in session.exec(select(Job))}
    assert states == {"build": JobState.DONE, "bundle": JobState.QUEUED}
    assert runner.worker.concurrency == 1


def test_the_pipeline_worker_leaves_build_run_alone() -> None:
    settings = get_settings().model_copy(update={"api_worker": True})
    background = _job_worker(settings)
    assert background is not None
    assert JobKind.BUILD_RUN not in background.worker.kinds()

"""The `build_run` handler body: seed, repo, launch, watch, finish (docs/BUILDS.md §2, §5).

    <build_workspace>/<build_id>/            the build directory
        repo/                                the git checkout the agent works in
        events.ndjson  stderr.log            the agent's output (appended on Continue)
        kickoff.md  run.lock.json            its prompt; which process runs this build

A job lands in one of three situations:

- **attach**: `run.lock.json` names a live process (the API restarted under a running
  build): watch it, start nothing. A dead one is collected the same way: one tick, finish.
- **resume**: the claude session already exists (Continue, or a retry after a crash):
  `claude --resume` with a short follow-up prompt.
- **fresh**: `git init`, the seed commit, the GitHub repo (unless `local`), then
  `claude --session-id` (`app.builds.publish.prepare_repo`; a pull request delivery puts
  the agent on `build/<repo_name>`).

Pushes follow `advanced.push`: after each commit, or once at the end. A pull request
delivery opens its PR after the last push (`publish.open_pull_request`), recorded as a
`system` event `Pull request: <url>` (`BuildPublic.pr_url` reads it back).

Every step of the setup is idempotent, so a retried job picks up where the last stopped.

**Usage limit.** When the CLI's run ends on the account's usage limit, the build finishes
`stopped` (stop reason `error`) with a message saying so; *Continue* resumes the same
session once the limit resets. It does not raise `UsageLimitError`: that would hold the job
and pause the whole queue, leaving the build shown as `building` while nothing runs, and
the commits so far are already safe.
"""

import logging
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlmodel import Session

from app.builds import service
from app.builds.agents import load_agent
from app.builds.events import BuildEvent, final_result, now_iso
from app.builds.git import Git
from app.builds.github import GhCli, GitHub
from app.builds.launch import branch_of, launch_spec, options_of, resolve_toolchains
from app.builds.process import (
    EVENTS_NAME,
    AttachedProcess,
    RunLock,
    Spawner,
    alive,
    clear_lock,
    file_size,
    read_from,
    read_lock,
    session_started,
    spawn_detached,
    stderr_tail,
    write_lock,
)
from app.builds.publish import SetupError, open_pull_request, prepare_repo
from app.builds.references import Fetch, fetch_readable
from app.builds.watch import Limits, Outcome, Progress, Signals, Watcher, kill_group
from app.core.config import Settings, get_settings
from app.db.session import release
from app.jobs.registry import HandlerResult, JobContext
from app.models.build import Build, BuildState, StopReason
from app.schemas.builds import PR_PREFIX

logger = logging.getLogger(__name__)

USAGE_LIMIT_MESSAGE = (
    "Claude's usage limit was reached, so the agent stopped. Your commits are kept. "
    "Press Continue once the limit resets to resume the same session."
)


class BuildSetupError(RuntimeError):
    """The build cannot start (no plan, no gh login, a taken repo name, no claude)."""


@dataclass
class Deps:
    """Every external effect of a run, swappable in tests."""

    settings: Settings = field(default_factory=get_settings)
    github: Callable[[Settings], GitHub] = lambda s: GhCli(s.gh_bin)
    spawn: Spawner = spawn_detached
    clock: Callable[[], float] = time.time
    sleep: Callable[[float], None] = time.sleep
    kill: Callable[[int, int], None] = kill_group
    fetch: Fetch = fetch_readable  # reference snapshots at seed time
    tick: float = 5.0
    grace: float = 15.0


def build_id_of(ctx: JobContext) -> uuid.UUID:
    raw = (ctx.job.payload or {}).get("build_id") or ctx.job.anchor
    if not raw:
        raise BuildSetupError("the build_run job names no build")
    return uuid.UUID(str(raw))


def build_dir(settings: Settings, build_id: uuid.UUID) -> Path:
    return Path(settings.build_workspace).expanduser() / str(build_id)


def _git(settings: Settings, repo: Path) -> Git:
    return Git(settings.git_bin, repo)


def _launch(
    session: Session, build: Build, git: Git, deps: Deps, dir_: Path, ctx: JobContext
) -> RunLock:
    """Start the agent (fresh or `--resume`) and write the lock. → the lock."""
    settings = deps.settings
    agent = load_agent(build.agent)
    try:
        warnings = prepare_repo(
            session, build, git, settings=settings, github=lambda: deps.github(settings),
            fetch=deps.fetch, toolchains=resolve_toolchains(agent, build),
        )  # fmt: skip
    except SetupError as exc:
        raise BuildSetupError(str(exc)) from exc
    if warnings:
        service.record_progress(session, build,
                                events=[BuildEvent(now_iso(), "error", w).as_json()
                                        for w in warnings])  # fmt: skip
    if build.plan is None:
        raise BuildSetupError("the build has no approved plan")
    events = dir_ / EVENTS_NAME
    if build.session_id is None:
        build.session_id = uuid.uuid4()
    session_id = str(build.session_id)
    resume = session_started(events, session_id)
    stops = build.stops
    cost_base = float(build.cost_usd or 0.0) if resume else 0.0
    budget = stops.get("max_budget_usd")
    if budget is not None:
        budget = max(float(budget) - cost_base, 0.01)
    resume_goal = str((ctx.job.payload or {}).get("goal") or "") if resume else None
    spec = launch_spec(build, agent, settings, session_id=session_id, resume=resume,
                       budget=budget, resume_goal=resume_goal)  # fmt: skip
    argv, prompt = spec.argv, spec.prompt
    offset, base_sha, started = file_size(events), git.head(), deps.clock()
    try:
        process = deps.spawn(argv, cwd=git.cwd, prompt=prompt, build_dir=dir_)
    except OSError as exc:
        raise BuildSetupError(f"cannot start {settings.claude_bin!r}: {exc}") from exc
    lock = RunLock(pid=process.pid, marker=session_id, started=started, offset=offset,
                   base_sha=base_sha, cost_base=cost_base)  # fmt: skip
    write_lock(dir_, lock)
    build.workspace = str(git.cwd)
    build.started_at = datetime.fromtimestamp(started, UTC)
    session.add(build)
    session.commit()
    _launched[lock.pid] = process
    return lock


# Processes this API started, by pid: polled directly (exit code known). After a restart
# the map is empty and `AttachedProcess` polls by pid and marker instead.
_launched: dict[int, Any] = {}


def _persist(
    session: Session, build_id: uuid.UUID, job_id: uuid.UUID
) -> Callable[[Progress], Signals]:
    """One short transaction per tick: append events and new commits, read the stop flag
    and whether the job is still ours."""
    from app.models import Job
    from app.models.enums import JobState

    def persist(progress: Progress) -> Signals:
        with Session(session.get_bind()) as tick:
            build = tick.get(Build, build_id)
            if build is None:
                return Signals(detach=True)
            commits = [c.as_json() for c in progress.commits]  # deduped by sha there
            if progress.events or commits:
                service.record_progress(
                    tick, build, events=[e.as_json() for e in progress.events] or None,
                    commits=commits or None,
                )  # fmt: skip
            job = tick.get(Job, job_id)
            owned = job is not None and job.state == JobState.RUNNING
            return Signals(stop_requested=bool(build.stop_requested), detach=not owned)

    return persist


def _verdict(outcome: Outcome, lock: RunLock, dir_: Path) -> dict[str, Any]:
    """The `service.finish` arguments for how the run ended."""
    final = final_result(read_from(dir_ / EVENTS_NAME, lock.offset))
    cost = lock.cost_base + (final.cost_usd or 0.0) if final is not None else None
    report = final.report if final is not None else None
    base = {"report": report, "cost_usd": cost}
    if outcome.stop_reason is not None:
        return {**base, "state": BuildState.STOPPED, "stop_reason": StopReason(outcome.stop_reason)}
    if final is None:
        detail = stderr_tail(dir_) or f"exit code {outcome.exit_code}"
        return {**base, "state": BuildState.FAILED, "stop_reason": StopReason.ERROR,
                "error": f"The agent ended without a result: {detail}"}  # fmt: skip
    if final.usage_limit:
        return {**base, "state": BuildState.STOPPED, "stop_reason": StopReason.ERROR,
                "error": f"{USAGE_LIMIT_MESSAGE} ({final.text[:300]})"}  # fmt: skip
    if final.budget_exhausted:
        return {**base, "state": BuildState.STOPPED, "stop_reason": StopReason.MAX_BUDGET}
    if final.is_error:
        detail = final.text or final.subtype or stderr_tail(dir_)
        return {**base, "state": BuildState.FAILED, "stop_reason": StopReason.ERROR,
                "error": f"The agent run failed: {detail[:2000]}"}  # fmt: skip
    status = (report or {}).get("status")
    if status == "gave_up":
        return {**base, "state": BuildState.STOPPED, "stop_reason": StopReason.AGENT_GAVE_UP}
    reason = StopReason.GOAL_REACHED if status == "goal_reached" else None
    return {**base, "state": BuildState.DONE, "stop_reason": reason}


def _finish(session: Session, build_id: uuid.UUID, verdict: dict[str, Any]) -> Build:
    build = service.get_build(session, build_id)
    cost = verdict.pop("cost_usd", None)
    if cost is not None:
        service.record_progress(session, build, cost_usd=cost)
    service.finish(session, build, **verdict)
    return build


def _deliver(
    session: Session, build_id: uuid.UUID, git: Git, deps: Deps, ctx: JobContext,
    report: dict[str, Any] | None,
) -> None:  # fmt: skip
    """Open the pull request of a pull request delivery, once its commits are pushed. A
    failure is an `error` event: the branch is pushed, the PR can be opened by hand."""
    build = service.get_build(session, build_id)
    try:
        url = open_pull_request(build, git, deps.github(deps.settings), report=report)
    except Exception as exc:
        event = BuildEvent(now_iso(), "error", f"The pull request was not opened: {str(exc)[:300]}")
    else:
        if url is None:
            return
        event = BuildEvent(now_iso(), "system", f"{PR_PREFIX}{url}")
    _persist(session, build_id, ctx.job.id)(Progress(events=[event], commits=[]))


def run_build(ctx: JobContext, deps: Deps | None = None) -> HandlerResult:
    deps = deps or Deps()
    session = ctx.session
    build_id = build_id_of(ctx)
    build = service.get_build(session, build_id)
    dir_ = build_dir(deps.settings, build_id)
    dir_.mkdir(parents=True, exist_ok=True)
    git = _git(deps.settings, dir_ / "repo")

    lock = read_lock(dir_)
    if lock is not None:  # a run this build started earlier: attach, or collect it
        process: Any = _launched.get(lock.pid) or AttachedProcess(lock.pid, lock.marker)
        events_offset = (
            file_size(dir_ / EVENTS_NAME) if alive(lock.pid, lock.marker) else lock.offset
        )
        logger.info(
            "Attaching to a running build", extra={"build_id": str(build_id), "pid": lock.pid}
        )
    else:
        lock = _launch(session, build, git, deps, dir_, ctx)
        process, events_offset = _launched[lock.pid], lock.offset
    release(session)  # no transaction open through hours of watching

    stops = build.stops
    options = options_of(build)
    branch = branch_of(options) or "main"
    push = (lambda: git.push(branch)) if git.has_remote() else None
    watcher = Watcher(
        git=git, process=process, events_path=dir_ / EVENTS_NAME, base_sha=lock.base_sha,
        started=lock.started, offset=events_offset,
        limits=Limits(max_minutes=float(stops.get("max_minutes", 90)),
                      max_commits=int(stops.get("max_commits", 30)),
                      hard_cap_minutes=float(deps.settings.build_hard_cap_minutes)),
        persist=_persist(session, build_id, ctx.job.id), push=push, tick=deps.tick,
        grace=deps.grace, clock=deps.clock, sleep=deps.sleep, kill=deps.kill,
        defer_push=options.advanced.push == "at_end",
    )  # fmt: skip
    outcome = watcher.run()
    if outcome.detached:  # the job went back to the queue: the next claim attaches
        return HandlerResult(result={"build_id": str(build_id), "detached": True})
    _launched.pop(lock.pid, None)

    verdict = _verdict(outcome, lock, dir_)
    try:
        watcher.flush_push()
    except Exception as exc:
        note = f"The last push failed ({str(exc)[:300]}); the commits are in {git.cwd}."
        verdict["error"] = f"{verdict.get('error') or ''} {note}".strip()
        _persist(session, build_id, ctx.job.id)(
            Progress(events=[BuildEvent(now_iso(), "error", note)], commits=[])
        )
    else:
        _deliver(session, build_id, git, deps, ctx, verdict.get("report"))
    build = _finish(session, build_id, verdict)
    clear_lock(dir_)
    return HandlerResult(result={
        "build_id": str(build_id), "state": build.state.value,
        "stop_reason": build.stop_reason.value if build.stop_reason else None,
        "commits": len(outcome.commits), "cost_usd": build.cost_usd,
    })  # fmt: skip

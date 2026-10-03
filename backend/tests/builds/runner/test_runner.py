"""`run_build` end to end: real git in tmp dirs, a fake spawner standing in for `claude`."""

import signal
import subprocess
import sys
import uuid
from collections.abc import Callable, Sequence
from pathlib import Path

import pytest
from sqlmodel import Session

from app.builds import runner as build_runner
from app.builds.git import Git
from app.builds.github import FakeGitHub
from app.builds.process import EVENTS_NAME, RunLock, read_lock, write_lock
from app.builds.runner import Deps, build_dir, run_build
from app.core.config import get_settings
from app.jobs import queue
from app.jobs.queue import JobSpec
from app.jobs.registry import JobContext, PermanentJobError
from app.models import Build
from app.models.build import BuildState, StopReason
from app.models.enums import JobKind
from app.pipeline.handlers import builds_run
from tests.builds.runner import ndjson
from tests.builds.runner.conftest import commit_in, sh_git
from tests.builds.runner.fakes import FakeClock, FakeProcess
from tests.papers.paper_fixtures import add_paper

PLAN = {
    "summary": "A tiny transformer.", "stack": ["Python", "PyTorch"], "repo_name": "tiny",
    "milestones": [{"title": t, "commit": f"feat: {t}", "deliverable": f"{t}.py",
                    "done_when": "tested"} for t in ("attention", "block", "train")],
    "layout": [{"path": "model.py", "purpose": "model"}], "out_of_scope": [], "risks": [],
    "questions": [],
}  # fmt: skip


def make_build(session: Session, *, visibility: str = "local", **stops: object) -> Build:
    paper = add_paper(session)
    build = Build(
        document_id=paper.id, preset="minimal-implementation", goal="A minimal transformer.",
        options={"repo_name": "tiny", "visibility": visibility, "owner": None,
                 "claude_attribution": False, "link_paper": True, "stack": "PyTorch",
                 "allow_web": False},
        stops={"max_minutes": 90, "max_commits": 30, "max_budget_usd": None,
               "done_when": [], **stops},
        plan=PLAN, state=BuildState.BUILDING,
    )  # fmt: skip
    session.add(build)
    session.commit()
    return build


def claim_job(session: Session, build: Build, payload: dict | None = None) -> JobContext:
    payload = {"build_id": str(build.id), **(payload or {})}
    queue.enqueue(
        session, JobSpec(kind=JobKind.BUILD_RUN, document_id=build.document_id, payload=payload)
    )
    job = queue.claim(session, [JobKind.BUILD_RUN])
    assert job is not None
    return JobContext(session=session, job=job)


class Agent:
    """A fake spawner: records argv and prompt; `script` plays the agent's part."""

    def __init__(self, clock: FakeClock, script: Callable[[Path, Path], None], *,
                 runs_for: float = 10, stubborn: bool = False) -> None:  # fmt: skip
        self.clock, self.script, self.runs_for, self.stubborn = clock, script, runs_for, stubborn
        self.calls: list[dict] = []
        self.process: FakeProcess | None = None

    def __call__(self, argv: Sequence[str], *, cwd: Path, prompt: str, build_dir: Path):
        self.calls.append({"argv": list(argv), "prompt": prompt, "cwd": cwd})
        self.script(cwd, build_dir / EVENTS_NAME)
        # claude stamps every line with the session it was given
        flag = "--resume" if "--resume" in argv else "--session-id"
        events = build_dir / EVENTS_NAME
        if events.exists():
            sid = argv[list(argv).index(flag) + 1]
            events.write_text(events.read_text().replace(ndjson.SESSION, sid))
        self.process = FakeProcess(self.clock, exit_at=self.clock() + self.runs_for,
                                   stubborn=self.stubborn)  # fmt: skip
        return self.process

    def kill(self, pid: int, sig: int) -> None:
        assert self.process is not None
        self.process.kill(pid, sig)


def deps(clock: FakeClock, agent: Agent, github: FakeGitHub | None = None) -> Deps:
    return Deps(
        settings=get_settings(),
        github=lambda _s: github or FakeGitHub(),
        spawn=agent,
        clock=clock,
        sleep=clock.sleep,
        kill=agent.kill,
        tick=5,
        grace=15,
    )


def commit(repo: Path, name: str, message: str) -> None:
    commit_in(repo, name, message, message)


def goal_reached(repo: Path, events: Path) -> None:
    commit(repo, "attention.py", "feat: attention")
    events.write_text(ndjson.init() + ndjson.tool("Bash", command="uv run pytest")
                      + ndjson.result(cost=0.75))  # fmt: skip


def test_a_local_build_seeds_runs_and_finishes_done(session: Session) -> None:
    build = make_build(session)
    clock = FakeClock()
    agent = Agent(clock, goal_reached)

    result = run_build(claim_job(session, build), deps(clock, agent))

    session.expire_all()
    build = session.get(Build, build.id)
    assert (build.state, build.stop_reason) == (BuildState.DONE, StopReason.GOAL_REACHED)
    assert build.report == ndjson.REPORT and build.cost_usd == 0.75
    assert [c["subject"] for c in build.commits] == ["feat: attention"]
    assert ("tool", "Bash: uv run pytest") in [(e["kind"], e["text"]) for e in build.events]
    assert build.repo_url is None and build.session_id is not None
    assert build.workspace == str(build_dir(get_settings(), build.id) / "repo")
    repo = Git("git", Path(build.workspace))
    assert repo.log()[0].subject == "chore: seed repository from Vaswani Attention"
    assert (Path(build.workspace) / "docs/PAPER.md").is_file()
    argv = agent.calls[0]["argv"]
    assert argv[argv.index("--session-id") + 1] == str(build.session_id)
    assert "Bash(uv:*)" in argv and "--max-budget-usd" not in argv
    assert agent.calls[0]["cwd"] == Path(build.workspace)
    assert "# Build" in agent.calls[0]["prompt"]
    assert read_lock(build_dir(get_settings(), build.id)) is None
    assert result.result["state"] == "done"


def test_continue_resumes_the_session_and_appends(session: Session) -> None:
    build = make_build(session, max_budget_usd=5.0)
    clock = FakeClock()
    run_build(claim_job(session, build), deps(clock, Agent(clock, goal_reached)))
    queue.complete(session, session.merge(build_job := _running(session)))  # free the slot
    del build_job

    def more(repo: Path, events: Path) -> None:
        commit(repo, "sample.py", "feat: sampling")
        with events.open("a") as f:
            f.write(ndjson.result(cost=0.5))

    agent = Agent(clock, more)
    run_build(claim_job(session, build, {"resume": True, "goal": "Add sampling."}),
              deps(clock, agent))  # fmt: skip

    session.expire_all()
    build = session.get(Build, build.id)
    argv = agent.calls[0]["argv"]
    assert argv[argv.index("--resume") + 1] == str(build.session_id)
    assert argv[argv.index("--max-budget-usd") + 1] == "4.25"  # what is left
    assert agent.calls[0]["prompt"].startswith("# Continue the build\n\nAdd sampling.")
    assert build.cost_usd == 1.25
    assert [c["subject"] for c in build.commits] == ["feat: attention", "feat: sampling"]


def _running(session: Session):
    from sqlmodel import select

    from app.models import Job
    from app.models.enums import JobState

    return session.exec(select(Job).where(Job.state == JobState.RUNNING)).one()


def test_max_commits_stops_the_agent(session: Session) -> None:
    build = make_build(session, max_commits=2)
    clock = FakeClock()
    repo_dir: list[Path] = []
    agent = Agent(clock, lambda repo, _events: repo_dir.append(repo), runs_for=10_000)
    steps = iter(range(100))
    clock.on_sleep.append(
        lambda _now: commit(repo_dir[0], f"f{(n := next(steps))}.py", f"feat: step {n}")
        if agent.process and agent.process.poll() is None else None
    )  # fmt: skip

    run_build(claim_job(session, build), deps(clock, agent))

    session.expire_all()
    build = session.get(Build, build.id)
    assert (build.state, build.stop_reason) == (BuildState.STOPPED, StopReason.MAX_COMMITS)
    assert agent.process is not None and agent.process.signals == [signal.SIGTERM]
    assert len(build.commits) >= 2


def test_the_budget_cap_is_a_max_budget_stop(session: Session) -> None:
    build = make_build(session, max_budget_usd=5.0)
    clock = FakeClock()

    def over_budget(_repo: Path, events: Path) -> None:
        events.write_text(ndjson.result(report=None, subtype="error_max_budget_usd",
                                        is_error=True, cost=5.0))  # fmt: skip

    run_build(claim_job(session, build), deps(clock, Agent(clock, over_budget)))
    session.expire_all()
    build = session.get(Build, build.id)
    assert (build.state, build.stop_reason) == (BuildState.STOPPED, StopReason.MAX_BUDGET)
    assert build.cost_usd == 5.0


def test_a_usage_limit_stops_and_says_continue_resumes(session: Session) -> None:
    build = make_build(session)
    clock = FakeClock()

    def limit(_repo: Path, events: Path) -> None:
        text = "You've hit your session limit · resets 8pm"
        events.write_text(ndjson.result(report=None, is_error=True, text=text))

    run_build(claim_job(session, build), deps(clock, Agent(clock, limit)))
    session.expire_all()
    build = session.get(Build, build.id)
    assert (build.state, build.stop_reason) == (BuildState.STOPPED, StopReason.ERROR)
    assert "usage limit" in build.error and "Continue" in build.error


def test_no_result_line_fails_with_the_stderr_tail(session: Session) -> None:
    build = make_build(session)
    clock = FakeClock()

    def crash(_repo: Path, events: Path) -> None:
        (events.parent / "stderr.log").write_text("Error: something exploded\n")

    run_build(claim_job(session, build), deps(clock, Agent(clock, crash)))
    session.expire_all()
    build = session.get(Build, build.id)
    assert build.state == BuildState.FAILED
    assert "something exploded" in build.error


def test_github_repo_is_created_and_every_commit_pushed(session: Session, tmp_path: Path) -> None:
    remote = tmp_path / "remote.git"
    sh_git(tmp_path, "init", "-q", "--bare", str(remote))
    github = FakeGitHub(login="octo", remote_dir=str(remote))
    build = make_build(session, visibility="private")
    clock = FakeClock()

    run_build(claim_job(session, build), deps(clock, Agent(clock, goal_reached), github))

    session.expire_all()
    build = session.get(Build, build.id)
    assert build.repo_url == "https://github.com/octo/tiny"
    assert github.created == [{"full_name": "octo/tiny", "private": True,
                               "description": "A tiny transformer."}]  # fmt: skip
    log = sh_git(remote, "log", "--format=%s", "main").splitlines()
    assert log[:2] == ["feat: attention", "chore: seed repository from Vaswani Attention"]


def test_a_taken_repo_name_fails_the_build_for_good(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    build = make_build(session, visibility="public")
    clock = FakeClock()
    agent = Agent(clock, goal_reached)
    github = FakeGitHub(login="octo", existing={"octo/tiny"})
    monkeypatch.setattr(
        builds_run, "run_build", lambda ctx: run_build(ctx, deps(clock, agent, github))
    )

    with pytest.raises(PermanentJobError, match="Pick another repository name"):
        builds_run.run_build_job(claim_job(session, build))

    session.expire_all()
    build = session.get(Build, build.id)
    assert (build.state, build.stop_reason) == (BuildState.FAILED, StopReason.ERROR)
    assert "octo/tiny already exists" in build.error
    assert agent.calls == []


def test_after_a_restart_it_attaches_to_the_live_agent(session: Session) -> None:
    """A real detached process carrying the session marker: attached, then stopped by you."""
    build = make_build(session)
    build.session_id = uuid.uuid4()
    session.add(build)
    session.commit()
    dir_ = build_dir(get_settings(), build.id)
    repo = Git("git", dir_ / "repo")
    repo.init()
    commit(repo.cwd, "README.md", "chore: seed repository")
    marker = str(build.session_id)
    proc = subprocess.Popen(  # noqa: S603  (fixed argv: a stand-in agent)
        [sys.executable, "-c", "import time; time.sleep(30)", marker], start_new_session=True
    )
    write_lock(dir_, RunLock(pid=proc.pid, marker=marker, started=FakeClock()(), offset=0,
                             base_sha=repo.head()))  # fmt: skip
    ctx = claim_job(session, build)
    build.stop_requested = True
    session.add(build)
    session.commit()

    def never(*_a, **_k):
        raise AssertionError("must attach, not spawn")

    try:
        run_build(ctx, Deps(settings=get_settings(), spawn=never, tick=0.01, grace=2))
    finally:
        proc.kill()
    assert proc.wait(timeout=5) == -signal.SIGTERM
    session.expire_all()
    build = session.get(Build, build.id)
    assert (build.state, build.stop_reason) == (BuildState.STOPPED, StopReason.USER)


def test_a_run_that_ended_while_the_api_was_down_is_collected(session: Session) -> None:
    build = make_build(session)
    build.session_id = uuid.uuid4()
    session.add(build)
    session.commit()
    dir_ = build_dir(get_settings(), build.id)
    dir_.mkdir(parents=True)
    repo = Git("git", dir_ / "repo")
    repo.init()
    commit(repo.cwd, "README.md", "chore: seed repository")
    base = repo.head()
    commit(repo.cwd, "a.py", "feat: a")
    (dir_ / EVENTS_NAME).write_text(ndjson.init() + ndjson.result(cost=2.0))
    write_lock(dir_, RunLock(pid=999_999, marker=str(build.session_id), started=0, offset=0,
                             base_sha=base))  # fmt: skip

    def never(*_a, **_k):
        raise AssertionError("must collect, not spawn")

    run_build(claim_job(session, build), Deps(settings=get_settings(), spawn=never, tick=0.01))
    session.expire_all()
    build = session.get(Build, build.id)
    assert (build.state, build.stop_reason) == (BuildState.DONE, StopReason.GOAL_REACHED)
    assert [c["subject"] for c in build.commits] == ["feat: a"] and build.cost_usd == 2.0
    assert build_runner._launched == {}

"""§7 delivery: a pull request from `build/<repo>`, pushes at the end, repo description and
topics, snapshots at seed time. Real git in tmp dirs, a fake GitHub and a fake agent."""

from pathlib import Path

from sqlmodel import Session

from app.builds.git import Git
from app.builds.github import FakeGitHub
from app.builds.references import FetchedText
from app.builds.runner import Deps, run_build
from app.core.config import get_settings
from app.models import Build
from app.schemas.builds import BuildPublic
from tests.builds.runner.conftest import sh_git
from tests.builds.runner.fakes import FakeClock
from tests.builds.runner.test_runner import Agent, claim_job, goal_reached, make_build


def deps(clock: FakeClock, agent: Agent, github: FakeGitHub, fetch=None) -> Deps:
    extra = {"fetch": fetch} if fetch else {}
    return Deps(settings=get_settings(), github=lambda _s: github, spawn=agent, clock=clock,
                sleep=clock.sleep, kill=agent.kill, tick=5, grace=15, **extra)  # fmt: skip


def remote_repo(tmp_path: Path) -> tuple[Path, FakeGitHub]:
    remote = tmp_path / "remote.git"
    sh_git(tmp_path, "init", "-q", "--bare", str(remote))
    return remote, FakeGitHub(login="octo", remote_dir=str(remote))


def with_options(session: Session, build: Build, **advanced: object) -> Build:
    build.options = {**build.options, "advanced": advanced}
    session.add(build)
    session.commit()
    return build


def branches(remote: Path) -> list[str]:
    return sh_git(remote, "branch", "--format=%(refname:short)").split()


def test_a_pull_request_delivery_works_on_a_branch_and_opens_one_pr(
    session: Session, tmp_path: Path
) -> None:
    remote, github = remote_repo(tmp_path)
    build = with_options(session, make_build(session, visibility="private"),
                         delivery="pull_request", description="Gates, minimal.",
                         topics=["transformers", "learning"])  # fmt: skip
    clock = FakeClock()
    agent = Agent(clock, goal_reached)

    run_build(claim_job(session, build), deps(clock, agent, github))

    session.expire_all()
    build = session.get(Build, build.id)
    assert github.created[0]["description"] == "Gates, minimal."
    assert github.topics == {"octo/tiny": ["transformers", "learning"]}
    assert sorted(branches(remote)) == ["build/tiny", "main"]
    assert sh_git(remote, "log", "--format=%s", "main").splitlines() == [
        "chore: seed repository from Vaswani Attention"
    ]  # main keeps only the seed
    assert sh_git(remote, "log", "-1", "--format=%s", "build/tiny").strip() == "feat: attention"
    assert Git("git", Path(build.workspace)).current_branch() == "build/tiny"
    (pr,) = github.prs
    assert (pr["full_name"], pr["head"], pr["base"]) == ("octo/tiny", "build/tiny", "main")
    assert pr["title"] == "A minimal transformer."
    assert "**Status**: goal reached" in pr["body"] and "## Goal" in pr["body"]
    assert "You work on the branch `build/tiny`" in agent.calls[0]["prompt"]
    public = BuildPublic.of(build, plan_versions_count=0)
    assert public.pr_url == "https://github.com/octo/tiny/pull/1"


def test_continue_pushes_the_branch_but_opens_no_second_pr(
    session: Session, tmp_path: Path
) -> None:
    from app.jobs import queue
    from tests.builds.runner.test_runner import _running

    remote, github = remote_repo(tmp_path)
    build = with_options(session, make_build(session, visibility="private"),
                         delivery="pull_request")  # fmt: skip
    clock = FakeClock()
    run_build(claim_job(session, build), deps(clock, Agent(clock, goal_reached), github))
    queue.complete(session, _running(session))

    def more(repo: Path, events: Path) -> None:
        (repo / "b.py").write_text("b")
        sh_git(repo, "add", "--all")
        sh_git(repo, "commit", "-q", "-m", "feat: b")
        with events.open("a") as f:
            f.write(Path(events).read_text().splitlines()[-1] + "\n")

    run_build(claim_job(session, build, {"resume": True}), deps(clock, Agent(clock, more), github))

    assert len(github.prs) == 1
    assert sh_git(remote, "log", "-1", "--format=%s", "build/tiny").strip() == "feat: b"


def test_push_at_end_pushes_once_after_the_run(session: Session, tmp_path: Path) -> None:
    remote, github = remote_repo(tmp_path)
    build = with_options(session, make_build(session, visibility="private"), push="at_end")
    clock = FakeClock()
    seen_on_remote: list[str] = []

    def agent_commits(repo: Path, events: Path) -> None:
        goal_reached(repo, events)
        clock.on_sleep.append(lambda _now: seen_on_remote.append(
            sh_git(remote, "log", "-1", "--format=%s", "main").strip()))  # fmt: skip

    run_build(claim_job(session, build), deps(clock, Agent(clock, agent_commits), github))

    assert seen_on_remote and set(seen_on_remote) == {
        "chore: seed repository from Vaswani Attention"
    }  # nothing pushed while it ran
    assert sh_git(remote, "log", "-1", "--format=%s", "main").strip() == "feat: attention"
    assert github.prs == []


def test_snapshots_are_taken_at_seed_time_and_a_failure_is_a_warning(session: Session) -> None:
    build = make_build(session)
    build.options = {**build.options, "references": [
        {"kind": "url", "url": "https://ok.example", "title": "Fine", "snapshot": True},
        {"kind": "url", "url": "https://down.example", "title": "Down", "snapshot": True},
    ]}  # fmt: skip
    session.add(build)
    session.commit()

    def fetch(url: str) -> FetchedText:
        if "down" in url:
            raise TimeoutError("timed out")
        return FetchedText(url=url, title=None, text="Readable text.")

    clock = FakeClock()
    agent = Agent(clock, goal_reached)
    run_build(claim_job(session, build), deps(clock, agent, FakeGitHub(), fetch))

    session.expire_all()
    build = session.get(Build, build.id)
    repo = Path(build.workspace)
    assert "Readable text." in (repo / "docs/references/01-fine.md").read_text()
    assert not (repo / "docs/references/02-down.md").exists()
    errors = [e["text"] for e in build.events if e["kind"] == "error"]
    assert errors == ["Could not snapshot https://down.example (timed out); it stays a link."]
    assert "`docs/REFERENCES.md` lists the reader's references" in agent.calls[0]["prompt"]

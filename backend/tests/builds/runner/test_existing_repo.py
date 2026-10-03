"""§7c end to end: a build into a folder of an existing repository. Real git in tmp dirs (a
worktree of the reader's repo, a clone of a bare "GitHub" remote), a fake GitHub and agent."""

from pathlib import Path
from typing import Any

import pytest
from sqlmodel import Session

from app.builds.github import FakeGitHub, RepoInfo
from app.builds.process import SURVEY_NAME
from app.builds.runner import BuildSetupError, build_dir, run_build
from app.core.config import get_settings
from app.jobs import queue
from app.models import Build
from app.models.build import BuildState, StopReason
from tests.builds.runner import ndjson
from tests.builds.runner.conftest import commit_in, make_user_repo, sh_git
from tests.builds.runner.fakes import FakeClock
from tests.builds.runner.test_delivery import deps
from tests.builds.runner.test_runner import Agent, _running, claim_job, goal_reached, make_build

FOLDER = "papers/attention"
SEED = "chore(papers-attention): seed papers/attention from Vaswani Attention"


def into(session: Session, target: dict[str, Any], **advanced: Any) -> Build:
    build = make_build(session)
    build.options = {**build.options, "target": {"folder": FOLDER, **target},
                     "advanced": advanced}  # fmt: skip
    session.add(build)
    session.commit()
    return build


def in_folder(repo: Path, events: Path) -> None:
    """The agent's part: one commit inside the folder, then a goal-reached result."""
    commit_in(repo, f"{FOLDER}/model.py", "attention = 1\n", "feat(attention): add attention")
    events.write_text(ndjson.init() + ndjson.result(cost=0.5))


def reload(session: Session, build: Build) -> Build:
    session.expire_all()
    found = session.get(Build, build.id)
    assert found is not None
    return found


def log(repo: Path, ref: str) -> list[str]:
    return sh_git(repo, "log", "--format=%s", ref).splitlines()


def worktrees(repo: Path) -> int:
    return sh_git(repo, "worktree", "list").count("\n")


# --- a repository on this machine -----------------------------------------------------------


def test_a_local_build_works_in_a_worktree_and_leaves_your_checkout_alone(
    session: Session, user_repo: Path
) -> None:
    (user_repo / "README.md").write_text("# my unsaved edit\n")
    (user_repo / "wip.txt").write_text("untracked work\n")
    head, status = sh_git(user_repo, "rev-parse", "HEAD"), sh_git(user_repo, "status", "--short")
    build = into(session, {"kind": "local", "path": str(user_repo)})
    clock = FakeClock()
    agent = Agent(clock, in_folder)

    run_build(claim_job(session, build), deps(clock, agent, FakeGitHub()))

    build = reload(session, build)
    assert (build.state, build.stop_reason) == (BuildState.DONE, StopReason.GOAL_REACHED)
    assert build.options["target"]["base_branch"] == "main" and build.repo_url is None
    # your checkout: same HEAD, branch and working tree
    assert sh_git(user_repo, "rev-parse", "HEAD") == head
    assert sh_git(user_repo, "branch", "--show-current").strip() == "main"
    assert sh_git(user_repo, "status", "--short") == status
    # the work is on its branch, and the worktree is gone
    assert log(user_repo, "build/attention")[:2] == ["feat(attention): add attention", SEED]
    files = sh_git(user_repo, "ls-tree", "-r", "--name-only", "build/attention").split()
    assert {f"{FOLDER}/README.md", f"{FOLDER}/docs/PAPER.md", f"{FOLDER}/docs/PLAN.md"} <= set(
        files
    )
    assert not (build_dir(get_settings(), build.id) / "repo").exists()
    assert worktrees(user_repo) == 1
    # what the agent was given
    argv, prompt = agent.calls[0]["argv"], agent.calls[0]["prompt"]
    assert f"Write({FOLDER}/**)" in argv and f"Edit({FOLDER}/**)" in argv
    assert "Write" not in argv and "Edit" not in argv and "Read" in argv
    assert f"Work only inside `{FOLDER}/`; the rest of the repository is read-only" in prompt
    assert "This repository's conventions" in prompt and "Use ruff." in prompt
    assert f"`{FOLDER}/docs/PAPER.md`" in prompt
    assert "Use ruff." in (build_dir(get_settings(), build.id) / SURVEY_NAME).read_text()


def test_continue_adds_the_worktree_back_on_the_same_branch_without_reseeding(
    session: Session, user_repo: Path
) -> None:
    build = into(session, {"kind": "local", "path": str(user_repo)})
    clock = FakeClock()
    run_build(claim_job(session, build), deps(clock, Agent(clock, in_folder), FakeGitHub()))
    queue.complete(session, _running(session))

    def more(repo: Path, events: Path) -> None:
        assert sh_git(repo, "branch", "--show-current").strip() == "build/attention"
        commit_in(repo, f"{FOLDER}/train.py", "train\n", "feat(train): add training")
        events.write_text(events.read_text())

    run_build(claim_job(session, build, {"resume": True}),
              deps(clock, Agent(clock, more), FakeGitHub()))  # fmt: skip

    assert log(user_repo, "build/attention").count(SEED) == 1
    assert log(user_repo, "build/attention")[0] == "feat(train): add training"
    assert worktrees(user_repo) == 1


def test_push_branch_without_an_origin_is_a_warning(session: Session, user_repo: Path) -> None:
    build = into(session, {"kind": "local", "path": str(user_repo), "push_branch": True})
    clock = FakeClock()

    run_build(claim_job(session, build), deps(clock, Agent(clock, in_folder), FakeGitHub()))

    errors = [e["text"] for e in reload(session, build).events if e["kind"] == "error"]
    assert errors == ["push_branch is on, but the repository has no `origin` remote: the "
                      "branch stays local."]  # fmt: skip


def test_push_branch_pushes_to_origin(session: Session, tmp_path: Path) -> None:
    origin = tmp_path / "origin.git"
    sh_git(tmp_path, "init", "-q", "--bare", str(origin))
    repo = make_user_repo(tmp_path)
    sh_git(repo, "remote", "add", "origin", str(origin))
    build = into(session, {"kind": "local", "path": str(repo), "push_branch": True})
    clock = FakeClock()

    run_build(claim_job(session, build), deps(clock, Agent(clock, in_folder), FakeGitHub()))

    assert log(origin, "build/attention")[0] == "feat(attention): add attention"


@pytest.mark.parametrize("confine", ["warn", "stop"])
def test_a_commit_outside_the_folder_is_flagged(
    session: Session, user_repo: Path, confine: str
) -> None:
    build = into(session, {"kind": "local", "path": str(user_repo), "confine": confine})
    clock = FakeClock()

    run_build(claim_job(session, build), deps(clock, Agent(clock, goal_reached), FakeGitHub()))

    build = reload(session, build)
    sha = sh_git(user_repo, "rev-parse", "--short=7", "build/attention").strip()
    message = f"Commit {sha} touched files outside {FOLDER}: attention.py"
    assert message in [e["text"] for e in build.events if e["kind"] == "error"]
    if confine == "warn":
        assert build.state is BuildState.DONE
    else:
        assert (build.state, build.stop_reason) == (BuildState.STOPPED, StopReason.ERROR)
        assert build.error == message
    assert worktrees(user_repo) == 1  # released however the run ended


def test_a_failed_setup_still_releases_the_worktree(session: Session, tmp_path: Path) -> None:
    repo = make_user_repo(tmp_path, extra={f"{FOLDER}/mine.md": "taken"})
    build = into(session, {"kind": "local", "path": str(repo)})
    clock = FakeClock()

    with pytest.raises(BuildSetupError, match="already has files"):
        run_build(claim_job(session, build), deps(clock, Agent(clock, in_folder), FakeGitHub()))

    assert worktrees(repo) == 1 and "build/attention" in sh_git(repo, "branch")


# --- a GitHub repository ------------------------------------------------------------------


def remote_of(tmp_path: Path, **extra: str) -> tuple[Path, FakeGitHub]:
    src = make_user_repo(tmp_path / "src", extra=extra or None)
    remote = tmp_path / "site.git"
    sh_git(tmp_path, "clone", "-q", "--bare", str(src), str(remote))
    gh = FakeGitHub(remote_dir=str(remote), info={"octo/site": RepoInfo("main", False, "WRITE")})
    return remote, gh


def test_a_github_build_clones_pushes_its_branch_and_opens_a_pr(
    session: Session, tmp_path: Path
) -> None:
    remote, gh = remote_of(tmp_path)
    build = into(session, {"kind": "github", "repo": "octo/site"}, delivery="pull_request")
    clock = FakeClock()

    run_build(claim_job(session, build), deps(clock, Agent(clock, in_folder), gh))

    build = reload(session, build)
    assert build.repo_url == "https://github.com/octo/site" and gh.cloned == ["octo/site"]
    assert log(remote, "build/attention")[:2] == ["feat(attention): add attention", SEED]
    assert log(remote, "main")[0] == "feat: core"  # the base is untouched
    (pr,) = gh.prs
    assert (pr["head"], pr["base"]) == ("build/attention", "main")
    assert f"Everything is in `{FOLDER}/`." in pr["body"]
    assert (build_dir(get_settings(), build.id) / "repo" / ".git").is_dir()  # the clone stays


def test_push_main_works_on_the_base_branch(session: Session, tmp_path: Path) -> None:
    remote, gh = remote_of(tmp_path)
    build = into(session, {"kind": "github", "repo": "octo/site"}, delivery="push_main")
    clock = FakeClock()
    agent = Agent(clock, in_folder)

    run_build(claim_job(session, build), deps(clock, agent, gh))

    assert log(remote, "main")[:2] == ["feat(attention): add attention", SEED]
    assert gh.prs == [] and "build/attention" not in sh_git(remote, "branch")
    assert "You work on the branch `main`" in agent.calls[0]["prompt"]


def test_a_folder_with_files_on_the_base_is_refused(session: Session, tmp_path: Path) -> None:
    remote, gh = remote_of(tmp_path, **{f"{FOLDER}/notes.md": "mine"})
    build = into(session, {"kind": "github", "repo": "octo/site"}, delivery="pull_request")
    clock = FakeClock()

    with pytest.raises(BuildSetupError, match="already has files"):
        run_build(claim_job(session, build), deps(clock, Agent(clock, in_folder), gh))

    assert "build/attention" not in sh_git(remote, "branch")


def test_deleting_a_build_removes_a_worktree_still_attached(
    session: Session, user_repo: Path
) -> None:
    from app.builds import service

    build = into(session, {"kind": "local", "path": str(user_repo), "base_branch": "main"})
    build.state = BuildState.STOPPED
    worktree = build_dir(get_settings(), build.id) / "repo"
    sh_git(user_repo, "worktree", "add", "-q", "-b", "build/attention", str(worktree), "main")

    service.delete_build(session, build)

    assert not worktree.exists() and worktrees(user_repo) == 1
    assert "build/attention" in sh_git(user_repo, "branch")

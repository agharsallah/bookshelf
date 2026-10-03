from pathlib import Path

import pytest

from app.builds.git import COAUTHOR_TRAILER, Git, GitError
from tests.builds.runner.conftest import commit_file, sh_git


def _message(git: Git, sha: str) -> str:
    return sh_git(git.cwd, "log", "-1", "--format=%B", sha)


def test_init_uses_main_and_starts_empty(repo: Git) -> None:
    assert repo.is_repo()
    assert repo.head() is None
    assert repo.log() == []
    branch = sh_git(repo.cwd, "symbolic-ref", "--short", "HEAD").strip()
    assert branch == "main"


def test_commit_all_adds_the_trailer_only_with_coauthor(repo: Git) -> None:
    (repo.cwd / "a.txt").write_text("a")
    with_trailer = repo.commit_all("feat: a", coauthor=True)
    (repo.cwd / "b.txt").write_text("b")
    without = repo.commit_all("feat: b", coauthor=False)

    assert COAUTHOR_TRAILER in _message(repo, with_trailer)
    assert "Co-Authored-By" not in _message(repo, without)


def test_has_changes_sees_untracked_files(repo: Git) -> None:
    assert not repo.has_changes()
    (repo.cwd / "new.txt").write_text("x")
    assert repo.has_changes()
    repo.commit_all("chore: x", coauthor=False)
    assert not repo.has_changes()


def test_log_lists_oldest_first_and_since_a_sha(repo: Git) -> None:
    first = commit_file(repo, "a.txt", "1", "chore: seed repository")
    commit_file(repo, "b.txt", "2", "feat(model): attention | with a pipe")
    third = commit_file(repo, "c.txt", "3", "test: cover it")

    everything = repo.log()
    assert [c.subject for c in everything] == [
        "chore: seed repository",
        "feat(model): attention | with a pipe",
        "test: cover it",
    ]
    assert everything[0].sha == first and everything[-1].at.startswith("20")
    assert repo.log(first) == everything[1:]
    assert repo.log(third) == []


def test_push_reaches_a_remote(repo: Git, tmp_path: Path) -> None:
    remote = tmp_path / "remote.git"
    sh_git(tmp_path, "init", "-q", "--bare", str(remote))
    sha = commit_file(repo, "a.txt", "1", "chore: seed")
    repo.add_remote(str(remote))
    repo.add_remote(str(remote))  # idempotent: set-url the second time
    repo.push()

    pushed = sh_git(remote, "rev-parse", "main").strip()
    assert pushed == sha
    assert repo.has_remote()


def test_a_failing_command_raises_with_its_stderr(repo: Git) -> None:
    with pytest.raises(GitError, match="push"):
        repo.push()


def test_use_gh_credentials_resets_inherited_helpers(repo: Git) -> None:
    repo.use_gh_credentials("/usr/local/bin/gh")
    helpers = sh_git(repo.cwd, "config", "--get-all", "credential.https://github.com.helper")
    helpers = helpers.splitlines()
    assert helpers == ["", "!/usr/local/bin/gh auth git-credential"]


def test_a_missing_binary_is_a_git_error(tmp_path: Path) -> None:
    with pytest.raises(GitError, match="could not run"):
        Git("/nonexistent/git", tmp_path).init()

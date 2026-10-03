"""Real git in temporary directories, with a fixed identity and no user config."""

import os
import subprocess
from collections.abc import Iterator
from pathlib import Path

import pytest

from app.builds.git import Git

GIT_ENV = {
    "GIT_AUTHOR_NAME": "Test Author",
    "GIT_AUTHOR_EMAIL": "author@example.com",
    "GIT_COMMITTER_NAME": "Test Author",
    "GIT_COMMITTER_EMAIL": "author@example.com",
    "GIT_CONFIG_GLOBAL": os.devnull,
    "GIT_CONFIG_NOSYSTEM": "1",
}


@pytest.fixture(autouse=True)
def _git_identity(monkeypatch: pytest.MonkeyPatch) -> None:
    for key, value in GIT_ENV.items():
        monkeypatch.setenv(key, value)


@pytest.fixture
def repo(tmp_path: Path) -> Iterator[Git]:
    git = Git("git", tmp_path / "repo")
    git.init()
    yield git


def sh_git(cwd: Path, *args: str) -> str:
    """Plain git, as the agent would run it (not through `app.builds.git`). → stdout."""
    done = subprocess.run(  # noqa: S603  (fixed argv in tests)
        ["git", *args],  # noqa: S607  (git from PATH, like the app's default `git_bin`)
        cwd=cwd, check=True, capture_output=True, text=True,
    )  # fmt: skip
    return done.stdout


def commit_in(repo: Path, name: str, text: str, message: str) -> None:
    (repo / name).parent.mkdir(parents=True, exist_ok=True)
    (repo / name).write_text(text)
    sh_git(repo, "add", "--all")
    sh_git(repo, "commit", "-q", "-m", message)


def commit_file(git: Git, name: str, text: str, message: str) -> str:
    commit_in(git.cwd, name, text, message)
    return git.head() or ""

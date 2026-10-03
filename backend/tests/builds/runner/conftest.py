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


@pytest.fixture(autouse=True)
def _fresh_target_cache() -> Iterator[None]:
    """`app.builds.targets` caches surveys by repository; every test starts cold."""
    from app.builds import targets

    targets.clear_cache()
    yield
    targets.clear_cache()


def make_user_repo(root: Path, *, extra: dict[str, str] | None = None) -> Path:
    """A repository like the reader's own: a Python project with a README and a CLAUDE.md,
    on `main`, plus anything in `extra` (path → text) committed on top."""
    src = root / "mine"
    src.mkdir(parents=True)
    sh_git(src, "init", "-q", "--initial-branch", "main")
    commit_in(src, "README.md", "# Mine\n\nThe reader's project.\n", "chore: init")
    commit_in(src, "pyproject.toml", "[project]\nname = 'mine'\n", "build: python")
    commit_in(src, "CLAUDE.md", "Use ruff. Tests go in tests/.\n", "docs: conventions")
    commit_in(src, "src/mine/core/deep.py", "x = 1\n", "feat: core")
    for path, text in (extra or {}).items():
        commit_in(src, path, text, f"chore: add {path}")
    return src


@pytest.fixture
def user_repo(tmp_path: Path) -> Path:
    return make_user_repo(tmp_path)

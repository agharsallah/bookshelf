"""A thin `git` wrapper for a build's checkout (`<build_workspace>/<id>/repo`).

Every call goes through one `run` seam (`subprocess.run` by default), so a test can record
argv or, as the build tests do, run real git in a temporary directory. The runner commits
the seed and pushes; the agent commits its own milestones (`git commit` is on its
allowlist, `git push` is not: docs/BUILDS.md B5).
"""

import os
import subprocess
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path

COAUTHOR_TRAILER = "Co-Authored-By: Claude <noreply@anthropic.com>"
# Unit separator / record separator: never inside a commit subject.
_FIELD = "\x1f"
_RECORD = "\x1e"
_TAIL = 1000

Run = Callable[..., subprocess.CompletedProcess[str]]


class GitError(RuntimeError):
    """A git command failed; the message carries its stderr."""


@dataclass(frozen=True, slots=True)
class Commit:
    sha: str
    subject: str
    at: str  # ISO 8601 committer date

    def as_json(self) -> dict[str, str]:
        return {"sha": self.sha, "subject": self.subject, "at": self.at}


class Git:
    def __init__(
        self,
        bin: str,
        cwd: Path,
        *,
        run: Run = subprocess.run,
        env: Mapping[str, str] | None = None,
        timeout: float = 120.0,
    ) -> None:
        self.bin = bin
        self.cwd = Path(cwd)
        self._run = run
        self._env = dict(env) if env is not None else None
        self._timeout = timeout

    def _git(self, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
        env = {**os.environ, **self._env} if self._env is not None else None
        try:
            done = self._run(
                [self.bin, *args],
                cwd=self.cwd,
                capture_output=True,
                text=True,
                timeout=self._timeout,
                check=False,
                env=env,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            raise GitError(f"git {args[0]} could not run: {exc}") from exc
        if check and done.returncode != 0:
            detail = (done.stderr or done.stdout or "").strip()[-_TAIL:]
            raise GitError(f"git {' '.join(args[:2])} failed ({done.returncode}): {detail}")
        return done

    # -- repository ------------------------------------------------------------------

    def init(self, default_branch: str = "main") -> None:
        self.cwd.mkdir(parents=True, exist_ok=True)
        self._git("init", "--initial-branch", default_branch)

    def is_repo(self) -> bool:
        return (self.cwd / ".git").exists()

    def is_work_tree(self) -> bool:
        """Inside a git work tree (a checkout or a worktree, not a bare repository)."""
        done = self._git("rev-parse", "--is-inside-work-tree", check=False)
        return done.returncode == 0 and done.stdout.strip() == "true"

    def has_changes(self) -> bool:
        return bool(self._git("status", "--porcelain").stdout.strip())

    def commit_all(self, message: str, *, coauthor: bool) -> str:
        """Stage everything and commit; the Claude trailer only when `coauthor`. → new sha."""
        if coauthor and COAUTHOR_TRAILER not in message:
            message = f"{message.rstrip()}\n\n{COAUTHOR_TRAILER}\n"
        self._git("add", "--all")
        self._git("commit", "--quiet", "--message", message)
        return self.head() or ""

    def head(self) -> str | None:
        done = self._git("rev-parse", "--verify", "--quiet", "HEAD", check=False)
        sha = done.stdout.strip()
        return sha if done.returncode == 0 and sha else None

    def author_name(self) -> str | None:
        """Who commits here (`git var GIT_AUTHOR_IDENT`: the env, then the config)."""
        done = self._git("var", "GIT_AUTHOR_IDENT", check=False)
        name = done.stdout.split("<", 1)[0].strip()
        return name if done.returncode == 0 and name else None

    # -- branches ----------------------------------------------------------------------

    def current_branch(self) -> str | None:
        done = self._git("symbolic-ref", "--quiet", "--short", "HEAD", check=False)
        return done.stdout.strip() or None

    def branch_exists(self, name: str) -> bool:
        ref = f"refs/heads/{name}"
        return self._git("show-ref", "--verify", "--quiet", ref, check=False).returncode == 0

    def local_branches(self) -> list[str]:
        out = self._git("for-each-ref", "--format=%(refname:short)", "refs/heads", check=False)
        return [line.strip() for line in out.stdout.splitlines() if line.strip()]

    def has_worktree_support(self) -> bool:
        return self._git("worktree", "list", check=False).returncode == 0

    def checkout(self, name: str) -> None:
        """Switch to branch `name`, creating it at HEAD when it does not exist yet."""
        if self.current_branch() == name:
            return
        if self.branch_exists(name):
            self._git("checkout", "--quiet", name)
        else:
            self._git("checkout", "--quiet", "-b", name)

    def ref_exists(self, ref: str) -> bool:
        """Any ref or commit-ish (`origin/main`, `refs/heads/x`, a sha)."""
        done = self._git("rev-parse", "--verify", "--quiet", f"{ref}^{{commit}}", check=False)
        return done.returncode == 0

    def checkout_new(self, name: str, start: str) -> None:
        """Create branch `name` at `start` and switch to it (`git checkout -b`)."""
        self._git("checkout", "--quiet", "-b", name, start)

    def merge_ff_only(self, ref: str) -> bool:
        """Fast-forward to `ref` when possible (never a merge commit). → whether it did."""
        return self._git("merge", "--quiet", "--ff-only", ref, check=False).returncode == 0

    def fetch(self, remote: str = "origin") -> None:
        self._git("fetch", "--quiet", "--prune", remote)

    def changed_paths(self, sha: str) -> list[str]:
        """The files commit `sha` touched (the root commit too)."""
        out = self._git("diff-tree", "--no-commit-id", "--name-only", "-r", "--root", sha).stdout
        return [line for line in out.splitlines() if line.strip()]

    def ls_tree(self, ref: str, path: str | None = None) -> list[tuple[str, str]]:
        """Every entry at `ref` (recursive, folders included) as `(type, path)`; with `path`,
        only that path and what is under it."""
        args = ["ls-tree", "-r", "-t", "-z", ref, *(["--", path] if path else [])]
        out = self._git(*args).stdout
        entries = []
        for record in out.split("\0"):
            meta, _, name = record.partition("\t")
            if name:
                entries.append((meta.split()[1], name))
        return entries

    def show_file(self, ref: str, path: str) -> str | None:
        """The text of `path` at `ref` (from the object store, never the working tree)."""
        done = self._git("show", f"{ref}:{path}", check=False)
        return done.stdout if done.returncode == 0 else None

    def worktree_add(self, dest: Path, branch: str, *, start: str | None = None) -> None:
        """`git worktree add`: a new branch at `start`, or the existing `branch`."""
        if start is not None:
            self._git("worktree", "add", "--quiet", "-b", branch, str(dest), start)
        else:
            self._git("worktree", "add", "--quiet", str(dest), branch)

    def worktree_remove(self, dest: Path) -> None:
        self._git("worktree", "remove", "--force", str(dest), check=False)
        self._git("worktree", "prune")

    def worktree_prune(self) -> None:
        self._git("worktree", "prune")

    def commits_between(self, base: str, head: str = "HEAD") -> int:
        done = self._git("rev-list", "--count", f"{base}..{head}", check=False)
        return int(done.stdout.strip() or 0) if done.returncode == 0 else 0

    def log(self, since_sha: str | None = None) -> list[Commit]:
        """Commits oldest first; with `since_sha`, only those after it."""
        if self.head() is None:
            return []
        span = [f"{since_sha}..HEAD"] if since_sha else ["HEAD"]
        out = self._git(
            "log", "--reverse", f"--format=%H{_FIELD}%s{_FIELD}%cI{_RECORD}", *span
        ).stdout
        commits = []
        for record in out.split(_RECORD):
            parts = record.strip().split(_FIELD)
            if len(parts) == 3:
                commits.append(Commit(sha=parts[0], subject=parts[1], at=parts[2]))
        return commits

    # -- remote ----------------------------------------------------------------------

    def add_remote(self, url: str, name: str = "origin") -> None:
        if name in self._git("remote").stdout.split():
            self._git("remote", "set-url", name, url)
        else:
            self._git("remote", "add", name, url)

    def has_remote(self, name: str = "origin") -> bool:
        return name in self._git("remote").stdout.split()

    def push(self, branch: str = "main", remote: str = "origin") -> None:
        self._git("push", "--quiet", "--set-upstream", remote, branch)

    def use_gh_credentials(self, gh_bin: str, host: str = "github.com") -> None:
        """Push over HTTPS with `gh`'s token (`gh auth git-credential`), whatever helpers
        the user's global config lists: the empty value resets the inherited ones."""
        key = f"credential.https://{host}.helper"
        self._git("config", "--unset-all", key, check=False)
        self._git("config", "--add", key, "")
        self._git("config", "--add", key, f"!{gh_bin} auth git-credential")

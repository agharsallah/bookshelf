"""GitHub, through the user's own `gh` login (docs/BUILDS.md B5, B9).

The runner, never the agent, talks to GitHub: it creates the empty repository here (with its
description and topics), then `git.py` adds the remote and pushes, the same way for a fresh
run and for a resume. With `delivery: pull_request` it opens the pull request at the end.
`GhCli` shells out through one `run` seam; `FakeGitHub` records calls for tests.
"""

import base64
import json
import re
import subprocess
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import quote

Run = Callable[..., subprocess.CompletedProcess[str]]
_TAIL = 1000
_PR_URL = re.compile(r"https://\S+/pull/\d+")


class GitHubError(RuntimeError):
    """`gh` failed. `permanent` means a retry cannot fix it (no login, a taken name)."""

    def __init__(self, message: str, *, permanent: bool = False) -> None:
        super().__init__(message)
        self.permanent = permanent


class RepoNameTaken(GitHubError):
    def __init__(self, full_name: str) -> None:
        super().__init__(
            f"The GitHub repository {full_name} already exists. Pick another repository "
            "name in the build options and start the build again.",
            permanent=True,
        )
        self.full_name = full_name


@dataclass(frozen=True, slots=True)
class RepoInfo:
    """`gh repo view --json viewerPermission,defaultBranchRef,isArchived`."""

    default_branch: str | None
    archived: bool
    viewer_permission: str  # ADMIN · MAINTAIN · WRITE · TRIAGE · READ · "" (unknown)

    @property
    def can_push(self) -> bool:
        return self.viewer_permission in PUSH_PERMISSIONS


PUSH_PERMISSIONS = frozenset({"ADMIN", "MAINTAIN", "WRITE"})


class GitHub(Protocol):
    def viewer(self) -> str: ...
    def repo_exists(self, full_name: str) -> bool: ...
    def create_repo(self, full_name: str, *, private: bool, description: str) -> str: ...
    def remote_url(self, full_name: str) -> str: ...
    def add_topics(self, full_name: str, topics: list[str]) -> None: ...
    def create_pr(self, full_name: str, *, head: str, base: str, title: str, body: str) -> str: ...
    # building into an existing repository (docs/BUILDS.md §7c)
    def list_repos(self, query: str = "") -> list[dict[str, Any]]: ...
    def repo_info(self, full_name: str) -> RepoInfo | None: ...
    def branches(self, full_name: str) -> list[str]: ...
    def tree(self, full_name: str, ref: str) -> list[tuple[str, str]]: ...
    def file(self, full_name: str, path: str, ref: str) -> str | None: ...
    def clone(self, full_name: str, dest: Path) -> None: ...


def _visibility(repo: dict[str, Any]) -> str:
    return "private" if repo.get("private") else "public"


def matches(repo: dict[str, Any], query: str) -> bool:
    """`query` in the repo's name or description, ignoring case ("" matches all)."""
    text = f"{repo.get('full_name', '')} {repo.get('description') or ''}".lower()
    return all(word in text for word in query.lower().split())


def full_name_of(repo_url: str) -> str:
    """`owner/name` from `https://github.com/owner/name`."""
    return "/".join(repo_url.rstrip("/").removesuffix(".git").split("/")[-2:])


def web_url(full_name: str) -> str:
    return f"https://github.com/{full_name}"


class GhCli:
    def __init__(
        self, bin: str = "gh", *, run: Run = subprocess.run, timeout: float = 60.0
    ) -> None:
        self.bin = bin
        self._run = run
        self._timeout = timeout

    def _gh(self, *args: str) -> subprocess.CompletedProcess[str]:
        try:
            return self._run(
                [self.bin, *args], capture_output=True, text=True, timeout=self._timeout,
                check=False,
            )  # fmt: skip
        except FileNotFoundError as exc:
            raise GitHubError(
                f"GitHub CLI {self.bin!r} not found: install gh and run `gh auth login`, "
                "or set the build's visibility to local.",
                permanent=True,
            ) from exc
        except (OSError, subprocess.SubprocessError) as exc:
            raise GitHubError(f"gh {args[0]} could not run: {exc}") from exc

    @staticmethod
    def _detail(done: subprocess.CompletedProcess[str]) -> str:
        return (done.stderr or done.stdout or "").strip()[-_TAIL:]

    def viewer(self) -> str:
        done = self._gh("api", "user", "--jq", ".login")
        login = done.stdout.strip()
        if done.returncode != 0 or not login:
            raise GitHubError(
                f"gh is not logged in ({self._detail(done)}). Run `gh auth login`.",
                permanent=True,
            )
        return login

    def repo_exists(self, full_name: str) -> bool:
        done = self._gh("repo", "view", full_name, "--json", "name")
        return done.returncode == 0

    def create_repo(self, full_name: str, *, private: bool, description: str) -> str:
        if self.repo_exists(full_name):
            raise RepoNameTaken(full_name)
        done = self._gh(
            "repo", "create", full_name, "--private" if private else "--public",
            "--description", description[:350],
        )  # fmt: skip
        if done.returncode != 0:
            detail = self._detail(done)
            if "already exists" in detail.lower() or "name already" in detail.lower():
                raise RepoNameTaken(full_name)
            raise GitHubError(f"gh repo create {full_name} failed: {detail}")
        url = done.stdout.strip().splitlines()[-1:] or [""]
        return url[0] if url[0].startswith("https://") else web_url(full_name)

    def remote_url(self, full_name: str) -> str:
        done = self._gh("repo", "view", full_name, "--json", "url")
        if done.returncode == 0:
            try:
                return f"{json.loads(done.stdout)['url']}.git"
            except (ValueError, KeyError, TypeError):
                pass
        return f"{web_url(full_name)}.git"

    def add_topics(self, full_name: str, topics: list[str]) -> None:
        if not topics:
            return
        args = [arg for topic in topics for arg in ("--add-topic", topic)]
        done = self._gh("repo", "edit", full_name, *args)
        if done.returncode != 0:
            raise GitHubError(f"gh repo edit {full_name} failed: {self._detail(done)}")

    def create_pr(self, full_name: str, *, head: str, base: str, title: str, body: str) -> str:
        """Open a pull request (→ its url); one already open for `head` is returned."""
        done = self._gh(
            "pr", "create", "--repo", full_name, "--head", head, "--base", base,
            "--title", title, "--body", body,
        )  # fmt: skip
        found = _PR_URL.search(f"{done.stdout}\n{done.stderr}")
        if found and (done.returncode == 0 or "already exists" in done.stderr.lower()):
            return found.group(0)
        raise GitHubError(f"gh pr create on {full_name} failed: {self._detail(done)}")

    # -- existing repositories (§7c) ---------------------------------------------------

    def _api_json(self, path: str) -> Any:
        done = self._gh("api", path)
        if done.returncode != 0:
            return None
        try:
            return json.loads(done.stdout)
        except ValueError:
            return None

    def list_repos(self, query: str = "") -> list[dict[str, Any]]:
        """Yours and your organizations' (the 100 updated last), as `RepoChoice` dicts."""
        path = (
            "user/repos?per_page=100&sort=updated"
            "&affiliation=owner,collaborator,organization_member"
        )
        rows = self._api_json(path)
        if not isinstance(rows, list):
            raise GitHubError("gh could not list your repositories. Run `gh auth login`.")
        out = []
        for r in rows:
            if not isinstance(r, dict) or r.get("archived"):
                continue
            perms = r.get("permissions") or {}
            out.append({
                "full_name": r.get("full_name", ""), "description": r.get("description"),
                "visibility": str(r.get("visibility") or _visibility(r)).upper(),
                "default_branch": r.get("default_branch"), "updated_at": r.get("updated_at"),
                "can_push": bool(perms.get("push") or perms.get("admin") or perms.get("maintain")),
            })  # fmt: skip
        return [r for r in out if matches(r, query)]

    def repo_info(self, full_name: str) -> RepoInfo | None:
        done = self._gh("repo", "view", full_name, "--json",
                        "viewerPermission,defaultBranchRef,isArchived")  # fmt: skip
        if done.returncode != 0:
            return None
        try:
            raw = json.loads(done.stdout)
        except ValueError:
            return None
        ref = raw.get("defaultBranchRef") or {}
        return RepoInfo(
            default_branch=ref.get("name") or None,
            archived=bool(raw.get("isArchived")),
            viewer_permission=str(raw.get("viewerPermission") or ""),
        )

    def branches(self, full_name: str) -> list[str]:
        rows = self._api_json(f"repos/{full_name}/branches?per_page=100")
        return [str(r["name"]) for r in rows or [] if isinstance(r, dict) and r.get("name")]

    def tree(self, full_name: str, ref: str) -> list[tuple[str, str]]:
        """Every entry at `ref` as `(type, path)`, type `blob` or `tree`."""
        raw = self._api_json(f"repos/{full_name}/git/trees/{quote(ref, safe='')}?recursive=1")
        entries = raw.get("tree") if isinstance(raw, dict) else None
        return [(str(e.get("type")), str(e.get("path"))) for e in entries or []
                if isinstance(e, dict) and e.get("path")]  # fmt: skip

    def file(self, full_name: str, path: str, ref: str) -> str | None:
        raw = self._api_json(f"repos/{full_name}/contents/{quote(path)}?ref={quote(ref, safe='')}")
        if not isinstance(raw, dict) or raw.get("encoding") != "base64":
            return None
        try:
            return base64.b64decode(str(raw.get("content", ""))).decode("utf-8", errors="replace")
        except ValueError:
            return None

    def clone(self, full_name: str, dest: Path) -> None:
        done = self._gh("repo", "clone", full_name, str(dest), "--", "--quiet")
        if done.returncode != 0:
            raise GitHubError(f"gh repo clone {full_name} failed: {self._detail(done)}")


@dataclass
class FakeGitHub:
    """In-memory GitHub: `existing` repos are taken; `created` records `create_repo`.
    `remote_dir` (a bare repo path) makes `remote_url` point somewhere git can push, and
    `clone` clone it (real git). For §7c: `info` per repo (a missing one is not found),
    `branch_names`, `trees` (`(type, path)` per repo) and `files` (`(repo, path)` → text),
    `listed` for `list_repos` (its calls counted in `list_calls`)."""

    login: str = "octo"
    existing: set[str] = field(default_factory=set)
    created: list[dict[str, object]] = field(default_factory=list)
    remote_dir: str | None = None
    logged_in: bool = True
    topics: dict[str, list[str]] = field(default_factory=dict)
    prs: list[dict[str, str]] = field(default_factory=list)
    info: dict[str, RepoInfo] = field(default_factory=dict)
    branch_names: dict[str, list[str]] = field(default_factory=dict)
    trees: dict[str, list[tuple[str, str]]] = field(default_factory=dict)
    files: dict[tuple[str, str], str] = field(default_factory=dict)
    listed: list[dict[str, Any]] = field(default_factory=list)
    list_calls: int = 0
    cloned: list[str] = field(default_factory=list)

    def viewer(self) -> str:
        if not self.logged_in:
            raise GitHubError("gh is not logged in. Run `gh auth login`.", permanent=True)
        return self.login

    def repo_exists(self, full_name: str) -> bool:
        return full_name in self.existing

    def create_repo(self, full_name: str, *, private: bool, description: str) -> str:
        if full_name in self.existing:
            raise RepoNameTaken(full_name)
        self.existing.add(full_name)
        self.created.append(
            {"full_name": full_name, "private": private, "description": description}
        )
        return web_url(full_name)

    def remote_url(self, full_name: str) -> str:
        return self.remote_dir or f"{web_url(full_name)}.git"

    def add_topics(self, full_name: str, topics: list[str]) -> None:
        self.topics.setdefault(full_name, []).extend(topics)

    def create_pr(self, full_name: str, *, head: str, base: str, title: str, body: str) -> str:
        self.prs.append({"full_name": full_name, "head": head, "base": base, "title": title,
                         "body": body})  # fmt: skip
        return f"{web_url(full_name)}/pull/{len(self.prs)}"

    def list_repos(self, query: str = "") -> list[dict[str, Any]]:
        self.list_calls += 1
        self.viewer()
        return [r for r in self.listed if matches(r, query)]

    def repo_info(self, full_name: str) -> RepoInfo | None:
        return self.info.get(full_name)

    def branches(self, full_name: str) -> list[str]:
        return list(self.branch_names.get(full_name, []))

    def tree(self, full_name: str, ref: str) -> list[tuple[str, str]]:
        return list(self.trees.get(full_name, []))

    def file(self, full_name: str, path: str, ref: str) -> str | None:
        return self.files.get((full_name, path))

    def clone(self, full_name: str, dest: Path) -> None:
        if self.remote_dir is None:
            raise GitHubError(f"no remote to clone {full_name} from")
        done = subprocess.run(  # noqa: S603 - a fixed argv, tests only
            ["git", "clone", "--quiet", self.remote_dir, str(dest)],  # noqa: S607
            capture_output=True, text=True, check=False,
        )  # fmt: skip
        if done.returncode != 0:
            raise GitHubError(f"clone failed: {done.stderr}")
        self.cloned.append(full_name)

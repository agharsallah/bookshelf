"""Building into an existing repository: is the target usable? (docs/BUILDS.md §7c)

    inspect_target(target, github=…, git_bin=…)   the §7c preflight checks, each a
                                                  `PreflightCheck` with its fix, plus the
                                                  default branch, the branches, the folder's
                                                  state at the base and the survey
    resolve_base(target, …)                       the base branch: the one given, else
                                                  GitHub's default / the local HEAD branch
    survey_for(options, …)                        the survey and its markdown, as the
                                                  planner, the kickoff and the context view
                                                  show it (cached 60 s)
    list_repos(github, query)                     `GET /builds/repos`, cached 60 s

Everything here only reads: `gh api` / `gh repo view`, and `git` on the object store. The
workspace itself (clone, worktree, seed) is `app.builds.existing_repo`.
"""

import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.builds.checks import PreflightCheck, failed, passed
from app.builds.git import Git, GitError
from app.builds.github import GitHub, GitHubError, matches
from app.builds.survey import Entries, render_survey_md, survey_from, survey_github, survey_local
from app.schemas.build_target import (
    BuildTarget,
    RepoSurvey,
    TargetCheck,
    TargetInspection,
    branch_slug,
)
from app.schemas.builds import BuildOptions

CACHE_SECONDS = 60.0
_PUSH_FIX = "Ask the owner for write access, or pick a repository you can push to."


def work_branch(target: BuildTarget, base: str | None, *, push_main: bool) -> str | None:
    """The branch the agent works on: the base itself for a GitHub `push_main`, else the
    given branch, else `build/<last folder segment>` (`papers/attention` →
    `build/attention`)."""
    if not target.existing:
        return None
    if target.kind == "github" and push_main:
        return base
    return target.branch or f"build/{branch_slug(target.folder or '')}"


def folder_state(entries: Entries, folder: str) -> tuple[bool, bool, bool]:
    """`(exists, empty, is_a_file)` of `folder` among `entries`."""
    inside = [(k, p) for k, p in entries if p == folder or p.startswith(f"{folder}/")]
    is_file = any(p == folder and k == "blob" for k, p in inside)
    has_files = any(k == "blob" for k, _ in inside)
    return bool(inside), not has_files, is_file


def _folder_checks(
    entries: Entries, target: BuildTarget, base: str, *, own: bool
) -> tuple[list[PreflightCheck], bool, bool]:
    folder = target.folder or ""
    exists, empty, is_file = folder_state(entries, folder)
    if is_file:
        check = failed("target_folder", f"`{folder}` is a file on {base}, not a folder.",
                       "Pick another folder.")  # fmt: skip
    elif not empty and not own:
        check = failed(
            "target_folder", f"The folder `{folder}/` already has files on {base}.",
            f"Pick another folder (e.g. `{folder}-2`), or remove it from {base} first.",
        )  # fmt: skip
    else:
        check = passed("target_folder", f"`{folder}/` is free on {base}.")
    return [check], exists, empty


def _branch_check(
    branch: str | None, base: str, branches: list[str], *, own: bool
) -> PreflightCheck:
    if branch is None or branch == base or branch not in branches or own:
        return passed("target_branch", f"The work goes on `{branch or base}`.")
    return failed("target_branch", f"The branch `{branch}` already exists.",
                  "Name another branch in the build options, or delete that one.")  # fmt: skip


def _inspection(
    checks: list[PreflightCheck], *, default: str | None = None, branches: list[str] | None = None,
    exists: bool = False, empty: bool = True, survey: RepoSurvey | None = None,
) -> TargetInspection:  # fmt: skip
    problems = [TargetCheck.model_validate(c) for c in checks if not c.ok]
    return TargetInspection(
        ok=not any(p.level == "error" for p in problems), problems=problems,
        default_branch=default, branches=branches or [], folder_exists=exists,
        folder_empty=empty, survey=survey,
    )  # fmt: skip


def _inspect_github(
    target: BuildTarget, gh: GitHub, *, push_main: bool, own: bool, with_survey: bool
) -> tuple[list[PreflightCheck], TargetInspection]:
    repo = target.repo or ""
    info = gh.repo_info(repo)
    if info is None:
        checks = [
            failed(
                "target_repo",
                f"The GitHub repository {repo} was not found.",
                "Check the name; `gh auth status` shows which account gh uses.",
            )
        ]
        return checks, _inspection(checks)
    checks = [passed("target_repo", f"{repo} exists.")]
    if not info.can_push:
        shown = info.viewer_permission or "unknown"
        checks.append(
            failed(
                "target_permission", f"You cannot push to {repo} (permission: {shown}).", _PUSH_FIX
            )
        )
    if info.archived:
        checks.append(failed("target_archived", f"{repo} is archived (read-only).",
                             "Unarchive it on GitHub, or pick another repository."))  # fmt: skip
    branches = gh.branches(repo)
    base = target.base_branch or info.default_branch
    if base is None or base not in branches:
        checks.append(failed("target_base", f"The base branch `{base}` does not exist in {repo}.",
                             "Pick one of the repository's branches."))  # fmt: skip
        return checks, _inspection(checks, default=info.default_branch, branches=branches)
    checks.append(passed("target_base", f"Work starts from `{base}`."))
    checks.append(_branch_check(work_branch(target, base, push_main=push_main), base,
                                branches, own=own))  # fmt: skip
    entries = gh.tree(repo, base)
    folder, exists, empty = _folder_checks(entries, target, base, own=own)
    survey = None
    if with_survey:
        survey = survey_from(entries, lambda p: gh.file(repo, p, base), folder=target.folder)
    checks += folder
    return checks, _inspection(checks, default=info.default_branch, branches=branches,
                               exists=exists, empty=empty, survey=survey)  # fmt: skip


def _inspect_local(
    target: BuildTarget, git_bin: str, *, own: bool, with_survey: bool
) -> tuple[list[PreflightCheck], TargetInspection]:
    path = Path(target.path or "")
    if not path.is_dir():
        checks = [
            failed(
                "target_path",
                f"{path} does not exist or is not a folder.",
                "Give the absolute path of a git repository on this machine.",
            )
        ]
        return checks, _inspection(checks)
    git = Git(git_bin, path)
    if not git.is_work_tree():
        checks = [failed("target_path", f"{path} is not a git repository.",
                         f"Run `git init` in {path}, or pick another folder.")]  # fmt: skip
        return checks, _inspection(checks)
    checks = [passed("target_path", f"{path} is a git repository.")]
    if not git.has_worktree_support():
        checks.append(failed("target_worktree", "`git worktree` is not available.",
                             "Update git to 2.5 or newer."))  # fmt: skip
    branches, default = git.local_branches(), git.current_branch()
    base = target.base_branch or default
    if base is None or base not in branches:
        message = (
            f"The base branch `{base}` does not exist in {path}."
            if base
            else f"{path} has a detached HEAD: there is no branch to start from."
        )
        checks.append(failed("target_base", message, "Name the base branch in the options."))
        return checks, _inspection(checks, default=default, branches=branches)
    checks.append(passed("target_base", f"Work starts from `{base}`."))
    checks.append(_branch_check(work_branch(target, base, push_main=False), base, branches,
                                own=own))  # fmt: skip
    ref = f"refs/heads/{base}"
    entries = git.ls_tree(ref)
    folder, exists, empty = _folder_checks(entries, target, base, own=own)
    survey = None
    if with_survey:
        survey = survey_from(entries, lambda p: git.show_file(ref, p), folder=target.folder)
    checks += folder
    return checks, _inspection(checks, default=default, branches=branches, exists=exists,
                               empty=empty, survey=survey)  # fmt: skip


def target_checks(
    target: BuildTarget, *, github: GitHub | None, git_bin: str, push_main: bool = False,
    own: bool = False, with_survey: bool = True,
) -> tuple[list[PreflightCheck], TargetInspection]:  # fmt: skip
    """Every check (passed ones too, for preflight) and the inspection. `own`: the branch
    and the folder may already be this build's (a re-approve after a failed run)."""
    if not target.existing:
        return [], _inspection([])
    try:
        if target.kind == "github":
            if github is None:
                raise GitHubError("no GitHub client")
            return _inspect_github(target, github, push_main=push_main, own=own,
                                   with_survey=with_survey)  # fmt: skip
        return _inspect_local(target, git_bin, own=own, with_survey=with_survey)
    except (GitError, GitHubError) as exc:
        checks = [failed("target_repo", f"The repository could not be read: {str(exc)[:300]}",
                         "Check `gh auth status` and the repository, then try again.")]  # fmt: skip
        return checks, _inspection(checks)


def inspect_target(
    target: BuildTarget, *, github: GitHub | None, git_bin: str, push_main: bool = False,
    own: bool = False,
) -> TargetInspection:  # fmt: skip
    """`POST /builds/target/inspect`; preflight runs the same checks."""
    return target_checks(target, github=github, git_bin=git_bin, push_main=push_main,
                         own=own)[1]  # fmt: skip


def resolve_base(target: BuildTarget, *, github: GitHub | None, git_bin: str) -> str | None:
    """The base branch given, else GitHub's default branch, else the local HEAD branch."""
    if target.base_branch or not target.existing:
        return target.base_branch
    try:
        if target.kind == "github":
            info = github.repo_info(target.repo or "") if github else None
            return info.default_branch if info else None
        return Git(git_bin, Path(target.path or "")).current_branch()
    except (GitError, GitHubError, OSError):
        return None


# --- the survey, cached -----------------------------------------------------------------------

_cache: dict[tuple[Any, ...], tuple[float, Any]] = {}
_lock = threading.Lock()


def _cached(key: tuple[Any, ...], make: Callable[[], Any], clock: Callable[[], float]) -> Any:
    now = clock()
    with _lock:
        hit = _cache.get(key)
        if hit is not None and now - hit[0] < CACHE_SECONDS:
            return hit[1]
    value = make()
    with _lock:
        _cache[key] = (now, value)
    return value


def clear_cache() -> None:
    with _lock:
        _cache.clear()


def survey_of(
    target: BuildTarget, base: str, *, github: GitHub | None, git_bin: str,
    clock: Callable[[], float] = time.monotonic,
) -> RepoSurvey:  # fmt: skip
    """The survey at `base` (cached 60 s). Raises `GitError` / `GitHubError`."""
    key = ("survey", target.kind, target.repo, target.path, base, target.folder)

    def make() -> RepoSurvey:
        if target.kind == "github":
            if github is None:
                raise GitHubError("no GitHub client")
            return survey_github(github, target.repo or "", base, folder=target.folder)
        return survey_local(target.path or "", base_branch=base, folder=target.folder,
                            git_bin=git_bin)  # fmt: skip

    survey: RepoSurvey = _cached(key, make, clock)
    return survey


@dataclass(frozen=True, slots=True)
class Surveyed:
    """A build's target as the planner and the agent see it."""

    survey: RepoSurvey | None  # None: a new repository, or one that could not be read
    markdown: str | None  # `render_survey_md`, or a line saying why it is missing
    base: str | None


NO_SURVEY = Surveyed(None, None, None)


def survey_for(options: BuildOptions, *, github: GitHub | None, git_bin: str) -> Surveyed:
    """The survey of a build's target; `NO_SURVEY` for a new repository. A survey that
    cannot be read says so in its markdown instead of failing the caller."""
    target = options.target
    if not target.existing:
        return NO_SURVEY
    base = resolve_base(target, github=github, git_bin=git_bin)
    try:
        if base is None:
            raise GitError("the base branch is unknown")
        survey = survey_of(target, base, github=github, git_bin=git_bin)
    except (GitError, GitHubError, OSError) as exc:
        why = (
            f"# Repository\n\n`{target.label}`: the survey could not be read ({str(exc)[:200]}).\n"
        )
        return Surveyed(None, why, base)
    markdown = render_survey_md(survey, where=target.label, base_branch=base,
                                folder=target.folder,
                                instructions=target.use_repo_instructions)  # fmt: skip
    return Surveyed(survey, markdown, base)


def list_repos(
    github: GitHub, query: str = "", *, key: str = "gh",
    clock: Callable[[], float] = time.monotonic,
) -> list[dict[str, Any]]:  # fmt: skip
    """Every repository you can see (cached 60 s per `key`), filtered by `query`."""
    rows: list[dict[str, Any]] = _cached(("repos", key), lambda: github.list_repos(""), clock)
    return [r for r in rows if matches(r, query)]

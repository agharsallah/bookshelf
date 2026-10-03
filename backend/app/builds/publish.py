"""The repository side of a run: seed it, publish it, and deliver it (docs/BUILDS.md §5, §7).

    prepare_repo(…)        init, the seed commit (`workspace_files.seed_files`, snapshots
                           fetched now), the GitHub repo with its description and topics, the
                           first push of `main`; then, for `delivery: pull_request`, the
                           agent's branch `build/<repo_name>` checked out. Each step only when
                           not done already, so a retried job is safe. → warnings
    open_pull_request(…)   at the end of a pull request run with commits on the branch: one
                           PR (title from the goal, body from the BuildReport), once

A `local` build skips everything GitHub: delivery, description and topics.
"""

from collections.abc import Callable, Mapping, Sequence
from typing import Any

from sqlmodel import Session

from app.builds.git import Git
from app.builds.github import GitHub, GitHubError, full_name_of
from app.builds.launch import branch_of, options_of
from app.builds.references import Fetch
from app.builds.seed import seed_repo
from app.builds.workspace_files import seed_files
from app.core.config import Settings
from app.models import Build, Document
from app.models.build import BuildVisibility
from app.schemas.builds import PR_PREFIX

BASE_BRANCH = "main"
_TITLE_LIMIT = 72
_DESCRIPTION_LIMIT = 350


class SetupError(RuntimeError):
    """The repository cannot be prepared (the paper is gone)."""


def repo_description(build: Build) -> str:
    """The reader's description, else the plan's summary, else the goal (≤ 350 chars)."""
    options = options_of(build)
    text = options.advanced.description or str((build.plan or {}).get("summary") or "")
    text = " ".join((text or build.goal).split())
    return text if len(text) <= _DESCRIPTION_LIMIT else f"{text[: _DESCRIPTION_LIMIT - 1]}…"


def prepare_repo(
    session: Session,
    build: Build,
    git: Git,
    *,
    settings: Settings,
    github: Callable[[], GitHub],
    fetch: Fetch | None,
    toolchains: Sequence[str],
) -> list[str]:
    """See the module docstring. → warnings (failed snapshots, topics that did not stick)."""
    options = options_of(build)
    warnings: list[str] = []
    if not git.is_repo():
        git.init(BASE_BRANCH)
    if git.head() is None:
        document = session.get(Document, build.document_id)
        if document is None:
            raise SetupError("the build's paper no longer exists")
        rendered = seed_files(session, build, author=git.author_name(), fetch=fetch,
                              toolchains=toolchains)  # fmt: skip
        warnings += rendered.warnings
        seed_repo(git, {f.path: f.content for f in rendered.files}, title=document.title,
                  link_paper=options.link_paper, coauthor=options.claude_attribution)  # fmt: skip
    if options.visibility is BuildVisibility.LOCAL:
        return warnings
    if not git.has_remote():
        gh = github()
        full_name = f"{options.owner or gh.viewer()}/{options.repo_name}"
        if build.repo_url is None:
            build.repo_url = gh.create_repo(
                full_name, private=options.visibility is not BuildVisibility.PUBLIC,
                description=repo_description(build),
            )  # fmt: skip
            session.add(build)
            session.commit()
            if options.advanced.topics:
                try:
                    gh.add_topics(full_name, list(options.advanced.topics))
                except GitHubError as exc:
                    warnings.append(f"The repository topics were not set: {exc}")
        git.add_remote(gh.remote_url(full_name))
        git.use_gh_credentials(settings.gh_bin)
        git.push(BASE_BRANCH)
    if branch := branch_of(options):
        git.checkout(branch)
    return warnings


# --- the pull request ---------------------------------------------------------------------


def pr_title(goal: str) -> str:
    line = " ".join(goal.strip().splitlines()[0].split()) if goal.strip() else "Build"
    if len(line) <= _TITLE_LIMIT:
        return line
    return f"{line[: _TITLE_LIMIT - 1].rsplit(' ', 1)[0]}…"


def _section(title: str, items: Any) -> list[str]:
    lines = [str(i) for i in items or [] if str(i).strip()]
    return [f"### {title}", "", *(f"- {line}" for line in lines), ""] if lines else []


def pr_body(build: Build, report: Mapping[str, Any] | None) -> str:
    parts = ["## Goal", "", build.goal.strip(), ""]
    if summary := str((build.plan or {}).get("summary") or "").strip():
        parts += ["## Plan", "", summary, "", "The full plan is in `docs/PLAN.md`.", ""]
    parts += ["## Report", ""]
    if not report:
        parts += ["The run ended without a report: a limit or a stop cut it short.", ""]
    else:
        parts += [f"**Status**: {str(report.get('status', 'partial')).replace('_', ' ')}", ""]
        parts += _section("Done", report.get("done"))
        parts += _section("Not done", report.get("not_done"))
        parts += _section("Next steps", report.get("next_steps"))
        if run_it := str(report.get("run_it") or "").strip():
            parts += ["### Run it", "", f"`{run_it}`", ""]
    return "\n".join(parts).rstrip() + "\n"


def has_pr(events: Sequence[Mapping[str, Any]]) -> bool:
    return any(e.get("kind") == "system" and str(e.get("text", "")).startswith(PR_PREFIX)
               for e in events)  # fmt: skip


def open_pull_request(
    build: Build, git: Git, github: GitHub, *, report: Mapping[str, Any] | None
) -> str | None:
    """Open the run's PR when it is due (see the module docstring). → its url, or None."""
    branch = branch_of(options_of(build))
    if branch is None or build.repo_url is None or has_pr(build.events):
        return None
    if git.commits_between(BASE_BRANCH, branch) == 0:
        return None
    return github.create_pr(full_name_of(build.repo_url), head=branch, base=BASE_BRANCH,
                            title=pr_title(build.goal), body=pr_body(build, report))  # fmt: skip

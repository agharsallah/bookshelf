"""The workspace of a build into an existing repository (docs/BUILDS.md §7c, B17, B18).

    prepare_workspace(…)   GitHub: `gh repo clone` into `<build dir>/repo` (once), fetch, and
                           the work branch checked out (`build/<folder slug>` from
                           `origin/<base>`, or the base itself for `push_main`). Local:
                           `git worktree add <build dir>/repo -b <branch> <base>` (the branch
                           exists on Continue: `worktree add <dir> <branch>`). Then the seed
                           into the folder, unless this build seeded already, and refused
                           when the folder has files; a GitHub branch is pushed right away.
                           Each step only when not done already, so a retried job is safe.
    release_workspace(…)   local only: `git worktree remove --force` + `git worktree prune`
                           at the end of every run, so the branch is yours to check out

Your own checkout is never touched: a GitHub build works in its clone, a local one in a
worktree that shares only the object store and the refs with your repository.
"""

from collections.abc import Callable, Sequence
from pathlib import Path

from sqlmodel import Session

from app.builds.git import Git, GitError
from app.builds.github import GitHub, web_url
from app.builds.launch import options_of
from app.builds.references import Fetch
from app.builds.seed import seed_repo
from app.builds.targets import resolve_base, work_branch
from app.builds.workspace_files import seed_files
from app.core.config import Settings
from app.models import Build, Document
from app.schemas.builds import BuildOptions


class SetupError(RuntimeError):
    """The workspace cannot be prepared (the folder is taken, the base is unknown…)."""


def _resolved_base(session: Session, build: Build, options: BuildOptions, *, github: GitHub | None,
                   git_bin: str) -> str:  # fmt: skip
    """The target's base branch, resolved and saved into the options when it was left blank."""
    target = options.target
    if target.base_branch:
        return target.base_branch
    base = resolve_base(target, github=github, git_bin=git_bin)
    if base is None:
        raise SetupError(f"The base branch of {target.label} is unknown: name it in the options.")
    build.options = {**build.options, "target": {**build.options.get("target", {}),
                                                 "base_branch": base}}  # fmt: skip
    session.add(build)
    session.commit()
    return base


def _clone(git: Git, full_name: str, gh: GitHub, *, base: str, branch: str) -> None:
    if not git.is_repo():
        git.cwd.parent.mkdir(parents=True, exist_ok=True)
        gh.clone(full_name, git.cwd)
    git.fetch()
    if git.current_branch() != branch:
        if git.branch_exists(branch):
            git.checkout(branch)
        elif git.ref_exists(f"origin/{branch}"):
            git.checkout_new(branch, f"origin/{branch}")
        else:
            git.checkout_new(branch, f"origin/{base}")
    if branch == base:  # push_main: catch up with the remote when nothing is unpushed
        git.merge_ff_only(f"origin/{base}")


def _worktree(git: Git, source: Git, *, base: str, branch: str) -> None:
    if git.is_repo():
        return  # a retry: the worktree is still there
    source.worktree_prune()  # a worktree whose folder vanished would block the add
    git.cwd.parent.mkdir(parents=True, exist_ok=True)
    if source.branch_exists(branch):
        source.worktree_add(git.cwd, branch)
    else:
        source.worktree_add(git.cwd, branch, start=base)


def _seed(session: Session, build: Build, git: Git, options: BuildOptions, *, base_ref: str,
          fetch: Fetch | None, toolchains: Sequence[str]) -> list[str]:  # fmt: skip
    """The seed commit into the folder, unless this build made it already. → warnings"""
    folder = options.target.folder or ""
    if build.workspace is not None or git.commits_between(base_ref, "HEAD") > 0:
        return []  # Continue, or a retry after the seed: the folder is this build's
    if any(kind == "blob" for kind, _ in git.ls_tree("HEAD", folder)):
        raise SetupError(
            f"The folder `{folder}/` already has files on {base_ref}: a build only writes "
            "into a new or empty folder. Pick another folder."
        )
    document = session.get(Document, build.document_id)
    if document is None:
        raise SetupError("the build's paper no longer exists")
    rendered = seed_files(session, build, author=git.author_name(), fetch=fetch,
                          toolchains=toolchains)  # fmt: skip
    seed_repo(git, {f.path: f.content for f in rendered.files}, title=document.title,
              link_paper=options.link_paper, coauthor=options.claude_attribution,
              folder=folder)  # fmt: skip
    return rendered.warnings


def prepare_workspace(
    session: Session,
    build: Build,
    git: Git,
    *,
    settings: Settings,
    github: Callable[[], GitHub],
    fetch: Fetch | None,
    toolchains: Sequence[str],
) -> list[str]:
    """See the module docstring; `git` is the workspace (`<build dir>/repo`). → warnings"""
    options = options_of(build)
    target = options.target
    gh = github() if target.kind == "github" else None
    try:
        base = _resolved_base(session, build, options, github=gh, git_bin=settings.git_bin)
        options = options_of(build)
        push_main = options.advanced.delivery == "push_main"
        branch = work_branch(target, base, push_main=push_main) or base
        if gh is not None:
            _clone(git, target.repo or "", gh, base=base, branch=branch)
            if build.repo_url is None:
                build.repo_url = web_url(target.repo or "")
                session.add(build)
                session.commit()
            git.use_gh_credentials(settings.gh_bin)
            base_ref = f"origin/{base}"
        else:
            _worktree(git, Git(settings.git_bin, Path(target.path or "")), base=base, branch=branch)
            base_ref = base
        warnings = _seed(session, build, git, options, base_ref=base_ref, fetch=fetch,
                         toolchains=toolchains)  # fmt: skip
        if gh is not None:
            git.push(branch)
    except GitError as exc:
        raise SetupError(str(exc)) from exc
    return warnings


def release_workspace(build: Build, repo_dir: Path, *, git_bin: str) -> list[str]:
    """Remove a local build's worktree (its branch stays in your repository). → warnings
    (uncommitted changes that went with it). A no-op for every other build."""
    options = options_of(build)
    if options.target.kind != "local" or not options.target.path:
        return []
    source = Git(git_bin, Path(options.target.path))
    warnings = []
    try:
        if (repo_dir / ".git").exists():
            if Git(git_bin, repo_dir).has_changes():
                warnings.append("Uncommitted changes in the worktree were discarded when it "
                                "was removed; every commit is on the branch.")  # fmt: skip
            source.worktree_remove(repo_dir)
        else:
            source.worktree_prune()
    except (GitError, OSError) as exc:
        warnings.append(f"The worktree {repo_dir} could not be removed: {str(exc)[:300]}")
    return warnings

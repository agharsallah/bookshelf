"""§7c preflight additions: `inspect_target` on a real local repo and on a fake GitHub."""

from pathlib import Path

import pytest
from sqlmodel import Session

from app.builds import preflight as pf
from app.builds import targets
from app.builds.github import FakeGitHub, RepoInfo
from app.models.build import BuildVisibility
from app.schemas.build_target import BuildTarget
from tests.builds.factories import FakeProbe, known_paper
from tests.builds.runner.conftest import make_user_repo, sh_git

FOLDER = "papers/attention"


def local(path: Path | str, **fields: object) -> BuildTarget:
    return BuildTarget.model_validate({"kind": "local", "path": str(path), "folder": FOLDER,
                                       **fields})  # fmt: skip


def github_target(**fields: object) -> BuildTarget:
    return BuildTarget.model_validate({"kind": "github", "repo": "octo/site", "folder": FOLDER,
                                       **fields})  # fmt: skip


def inspect(target: BuildTarget, gh: FakeGitHub | None = None, **kw: bool):
    return targets.inspect_target(target, github=gh, git_bin="git", **kw)


def keys(inspection) -> list[str]:
    return [p.key for p in inspection.problems]


def fake_github(**info: object) -> FakeGitHub:
    fields = {"default_branch": "main", "archived": False, "viewer_permission": "WRITE", **info}
    return FakeGitHub(
        info={"octo/site": RepoInfo(**fields)},  # type: ignore[arg-type]
        branch_names={"octo/site": ["main", "dev", "build/attention"]},
        trees={"octo/site": [("blob", "README.md"), ("tree", "papers"),
                             ("blob", "papers/other.md")]},
        files={("octo/site", "README.md"): "# Site"},
    )  # fmt: skip


def test_a_free_local_target_passes_with_its_default_branch_and_survey(user_repo: Path) -> None:
    sh_git(user_repo, "branch", "dev")

    got = inspect(local(user_repo))

    assert got.ok and got.problems == []
    assert got.default_branch == "main" and got.branches == ["dev", "main"]
    assert (got.folder_exists, got.folder_empty) == (False, True)
    assert got.survey is not None and got.survey.toolchains == ["python"]


@pytest.mark.parametrize(
    ("make", "key"),
    [
        (lambda tmp: local(tmp / "nowhere"), "target_path"),
        (lambda tmp: local(tmp), "target_path"),  # a folder, not a repository
        (lambda tmp: local(make_user_repo(tmp), base_branch="nope"), "target_base"),
        (lambda tmp: local(make_user_repo(tmp, extra={f"{FOLDER}/x.md": "x"})), "target_folder"),
        (
            lambda tmp: local(make_user_repo(tmp, extra={"papers": "a file"}), folder="papers"),
            "target_folder",
        ),
    ],
)
def test_each_local_problem_comes_with_a_fix(tmp_path: Path, make, key: str) -> None:
    got = inspect(make(tmp_path))

    assert not got.ok and key in keys(got)
    problem = next(p for p in got.problems if p.key == key)
    assert problem.level == "error" and problem.fix


def test_a_taken_branch_blocks_unless_it_is_the_builds_own(user_repo: Path) -> None:
    sh_git(user_repo, "branch", "build/attention")

    assert keys(inspect(local(user_repo))) == ["target_branch"]
    assert inspect(local(user_repo), own=True).ok


def test_a_non_empty_folder_reports_exists_and_not_empty(tmp_path: Path) -> None:
    repo = make_user_repo(tmp_path, extra={f"{FOLDER}/notes.md": "mine"})

    got = inspect(local(repo))

    assert (got.folder_exists, got.folder_empty) == (True, False)


def test_a_detached_head_needs_a_named_base(user_repo: Path) -> None:
    sh_git(user_repo, "checkout", "-q", "--detach")

    assert keys(inspect(local(user_repo))) == ["target_base"]
    assert inspect(local(user_repo, base_branch="main")).ok


def test_a_github_target_is_inspected_through_the_api() -> None:
    got = inspect(github_target(branch="build/new"), fake_github())

    assert got.ok and got.default_branch == "main"
    assert got.survey is not None and got.survey.readme == "# Site"
    assert (got.folder_exists, got.folder_empty) == (False, True)


@pytest.mark.parametrize(
    ("gh", "target", "key"),
    [
        (FakeGitHub(), github_target(), "target_repo"),
        (fake_github(viewer_permission="READ"), github_target(branch="b"), "target_permission"),
        (fake_github(archived=True), github_target(branch="b"), "target_archived"),
        (fake_github(), github_target(base_branch="gone", branch="b"), "target_base"),
        (fake_github(), github_target(), "target_branch"),  # build/attention exists
        (fake_github(), github_target(folder="papers", branch="b"), "target_folder"),
    ],
)
def test_each_github_problem_comes_with_a_fix(gh: FakeGitHub, target: BuildTarget, key: str):
    got = inspect(target, gh)

    assert not got.ok and key in keys(got)
    assert all(p.fix for p in got.problems)


def test_push_main_works_on_the_base_so_no_branch_is_taken() -> None:
    assert inspect(github_target(), fake_github(), push_main=True).ok


def test_preflight_adds_the_target_checks_and_skips_gh_for_a_local_one(
    session: Session, user_repo: Path
) -> None:
    probe = FakeProbe(missing=["gh"])
    result = pf.preflight(session, known_paper(session), visibility=BuildVisibility.PRIVATE,
                          probe=probe, target=local(user_repo))  # fmt: skip

    checks = {c.key for c in result.checks}
    assert result.ready and {"target_path", "target_base", "target_folder"} <= checks
    assert not {"gh_cli", "gh_auth", "gh_scope"} & checks
    assert {"claude_cli", "git_cli"} <= checks
    assert result.inspection is not None and result.inspection.default_branch == "main"


def test_preflight_blocks_on_a_github_target_problem(session: Session) -> None:
    result = pf.preflight(session, known_paper(session), visibility=BuildVisibility.PRIVATE,
                          probe=FakeProbe(), target=github_target(branch="b"),
                          github=fake_github(archived=True))  # fmt: skip

    assert not result.ready and [c.key for c in result.errors] == ["target_archived"]
    assert {"gh_cli", "gh_auth", "gh_scope"} <= {c.key for c in result.checks}


def test_repo_listings_are_cached_and_filtered() -> None:
    gh = FakeGitHub(listed=[
        {"full_name": "octo/site", "description": "My website", "visibility": "PUBLIC",
         "default_branch": "main", "updated_at": None, "can_push": True},
        {"full_name": "acme/lab", "description": None, "visibility": "PRIVATE",
         "default_branch": "main", "updated_at": None, "can_push": False},
    ])  # fmt: skip
    now = [0.0]

    assert [r["full_name"] for r in targets.list_repos(gh, "WEB", key="t", clock=lambda: now[0])
            ] == ["octo/site"]  # fmt: skip
    assert len(targets.list_repos(gh, "", key="t", clock=lambda: now[0])) == 2
    now[0] = targets.CACHE_SECONDS + 1
    targets.list_repos(gh, "", key="t", clock=lambda: now[0])
    assert gh.list_calls == 2

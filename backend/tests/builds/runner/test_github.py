import subprocess
from typing import Any

import pytest

from app.builds.github import FakeGitHub, GhCli, GitHubError, RepoNameTaken


class Recorder:
    """A `run` seam: answers each argv prefix with (returncode, stdout, stderr)."""

    def __init__(self, replies: dict[tuple[str, ...], tuple[int, str, str]]) -> None:
        self.replies = replies
        self.calls: list[list[str]] = []

    def __call__(self, argv: list[str], **_: Any) -> subprocess.CompletedProcess[str]:
        self.calls.append(argv)
        for prefix, (code, out, err) in self.replies.items():
            if tuple(argv[1 : 1 + len(prefix)]) == prefix:
                return subprocess.CompletedProcess(argv, code, out, err)
        return subprocess.CompletedProcess(argv, 1, "", "unexpected call")


def test_viewer_reads_the_login() -> None:
    run = Recorder({("api", "user"): (0, "octocat\n", "")})
    assert GhCli("gh", run=run).viewer() == "octocat"
    assert run.calls == [["gh", "api", "user", "--jq", ".login"]]


def test_viewer_without_login_is_permanent() -> None:
    run = Recorder({("api", "user"): (1, "", "not logged in")})
    with pytest.raises(GitHubError, match="gh auth login") as caught:
        GhCli("gh", run=run).viewer()
    assert caught.value.permanent


def test_create_repo_is_private_and_never_pushes() -> None:
    run = Recorder({
        ("repo", "view"): (1, "", "Could not resolve to a Repository"),
        ("repo", "create"): (0, "https://github.com/octo/attn\n", ""),
    })  # fmt: skip
    url = GhCli("gh", run=run).create_repo("octo/attn", private=True, description="Attention")

    assert url == "https://github.com/octo/attn"
    create = run.calls[-1]
    assert create == ["gh", "repo", "create", "octo/attn", "--private", "--description",
                      "Attention"]  # fmt: skip
    assert "--source" not in create and "--push" not in create


def test_create_repo_public() -> None:
    run = Recorder({("repo", "view"): (1, "", ""), ("repo", "create"): (0, "", "")})
    url = GhCli("gh", run=run).create_repo("octo/x", private=False, description="d")
    assert "--public" in run.calls[-1]
    assert url == "https://github.com/octo/x"


def test_a_taken_name_says_to_pick_another() -> None:
    run = Recorder({("repo", "view"): (0, '{"name":"attn"}', "")})
    with pytest.raises(RepoNameTaken, match="Pick another repository name") as caught:
        GhCli("gh", run=run).create_repo("octo/attn", private=True, description="d")
    assert caught.value.permanent
    assert not any(call[1:3] == ["repo", "create"] for call in run.calls)


def test_a_race_on_the_name_is_still_taken() -> None:
    run = Recorder({
        ("repo", "view"): (1, "", ""),
        ("repo", "create"): (1, "", "GraphQL: Name already exists on this account"),
    })  # fmt: skip
    with pytest.raises(RepoNameTaken):
        GhCli("gh", run=run).create_repo("octo/attn", private=True, description="d")


def test_remote_url_from_view_or_derived() -> None:
    run = Recorder({("repo", "view"): (0, '{"url":"https://github.com/Octo/Attn"}', "")})
    assert GhCli("gh", run=run).remote_url("octo/attn") == "https://github.com/Octo/Attn.git"
    missing = Recorder({})
    assert GhCli("gh", run=missing).remote_url("o/r") == "https://github.com/o/r.git"


def test_missing_gh_is_permanent() -> None:
    def run(argv: list[str], **_: Any) -> subprocess.CompletedProcess[str]:
        raise FileNotFoundError(argv[0])

    with pytest.raises(GitHubError, match="not found") as caught:
        GhCli("gh", run=run).viewer()
    assert caught.value.permanent


def test_fake_github_tracks_created_repos() -> None:
    fake = FakeGitHub(existing={"octo/taken"})
    assert fake.create_repo("octo/new", private=True, description="d").endswith("octo/new")
    assert fake.repo_exists("octo/new")
    with pytest.raises(RepoNameTaken):
        fake.create_repo("octo/taken", private=True, description="d")


def test_create_pr_returns_its_url_or_the_open_one() -> None:
    fresh = Recorder({("pr", "create"): (0, "https://github.com/octo/attn/pull/3\n", "")})
    url = GhCli("gh", run=fresh).create_pr("octo/attn", head="build/attn", base="main",
                                           title="T", body="B")  # fmt: skip
    assert url == "https://github.com/octo/attn/pull/3"
    assert fresh.calls[0][:9] == ["gh", "pr", "create", "--repo", "octo/attn", "--head",
                                  "build/attn", "--base", "main"]  # fmt: skip

    taken = Recorder({("pr", "create"): (
        1, "", 'a pull request for branch "build/attn" already exists:\n'
               "https://github.com/octo/attn/pull/1\n")})  # fmt: skip
    assert (
        GhCli("gh", run=taken).create_pr(
            "octo/attn", head="build/attn", base="main", title="T", body="B"
        )
        == "https://github.com/octo/attn/pull/1"
    )


def test_create_pr_failure_is_an_error() -> None:
    run = Recorder({("pr", "create"): (1, "", "no commits between main and build/attn")})
    with pytest.raises(GitHubError, match="no commits"):
        GhCli("gh", run=run).create_pr("o/a", head="b", base="main", title="T", body="B")


def test_topics_are_added_in_one_edit() -> None:
    run = Recorder({("repo", "edit"): (0, "", "")})
    GhCli("gh", run=run).add_topics("octo/attn", ["nlp", "learning"])
    GhCli("gh", run=run).add_topics("octo/attn", [])
    assert run.calls == [["gh", "repo", "edit", "octo/attn", "--add-topic", "nlp",
                          "--add-topic", "learning"]]  # fmt: skip

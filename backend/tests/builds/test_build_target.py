"""§7c `options.target`: what a target may be, and how an existing repository's options are
normalized (old rows stay `kind: new`)."""

import pytest
from pydantic import ValidationError

from app.builds.launch import branch_of
from app.builds.options import merge_options, resolve_options
from app.builds.toolchains import allowed_tools
from app.schemas.build_target import BuildTarget, BuildTargetInput, branch_problem
from app.schemas.builds import BuildOptions, BuildOptionsInput
from app.services import app_settings

GH = {"kind": "github", "repo": "octo/site", "folder": "papers/attention"}
LOCAL = {"kind": "local", "path": "/home/ada/site", "folder": "papers/attention"}


def test_a_row_stored_before_7c_is_a_new_repository():
    options = BuildOptions.model_validate({"repo_name": "tiny", "visibility": "private"})

    assert options.target == BuildTarget() and options.target.kind == "new"
    assert branch_of(options) is None


@pytest.mark.parametrize(
    "folder",
    ["../up", "papers/../../etc", "/abs", "a//b", "./a", "a/./b", ".git/hooks", "a b",
     "x" * 201, "$(rm)", "-flag"],
)  # fmt: skip
def test_unsafe_folders_are_refused(folder: str):
    with pytest.raises(ValidationError):
        BuildTarget.model_validate({**GH, "folder": folder})


def test_a_folder_is_normalized_and_blank_fields_are_null():
    target = BuildTarget.model_validate({**GH, "folder": "papers/attention/", "branch": " "})

    assert (target.folder, target.branch) == ("papers/attention", None)


@pytest.mark.parametrize("repo", ["octo", "octo/site/x", "o" * 40 + "/x", "octo/s ite", "octo/"])
def test_a_github_repo_is_owner_slash_name(repo: str):
    with pytest.raises(ValidationError, match="owner/name"):
        BuildTarget.model_validate({**GH, "repo": repo})


@pytest.mark.parametrize(
    ("name", "ok"),
    [("build/attention", True), ("feat/x-1.2", True), ("a..b", False), ("x@{1}", False),
     ("x.lock", False), ("a/b.lock/c", False), ("/x", False), ("x/", False), ("-x", False),
     ("a b", False), ("a/.b", False), ("x.", False), ("@", False)],
)  # fmt: skip
def test_branch_names_follow_git_check_ref_format(name: str, ok: bool):
    assert (branch_problem(name) is None) is ok


@pytest.mark.parametrize(
    ("fields", "message"),
    [
        ({**GH, "folder": None}, "needs a `folder`"),
        ({**GH, "push_branch": True}, "`push_branch` is for a local target"),
        ({**GH, "repo": None}, "needs `repo`"),
        ({**LOCAL, "path": "relative/site"}, "absolute path"),
        ({**LOCAL, "repo": "octo/site"}, "no `repo`"),
        ({"kind": "new", "folder": "x"}, "takes no `folder`"),
    ],
)
def test_each_kind_takes_its_own_fields(fields: dict, message: str):
    with pytest.raises(ValidationError, match=message):
        BuildTarget.model_validate(fields)


def test_push_branch_is_for_local_targets():
    assert BuildTarget.model_validate({**LOCAL, "push_branch": True}).push_branch


def test_an_existing_repository_normalizes_what_only_a_new_one_has():
    options = BuildOptions.model_validate({
        "repo_name": "ignored", "owner": "acme", "visibility": "public", "target": GH,
        "advanced": {"license": "MIT", "description": "d", "topics": ["x"],
                     "delivery": "push_main"},
    })  # fmt: skip

    assert (options.repo_name, options.owner, options.visibility) == (None, None, "private")
    assert (options.advanced.license, options.advanced.description) == ("none", None)
    assert options.advanced.topics == [] and options.advanced.delivery == "push_main"
    assert branch_of(options) is None  # push_main into a base not resolved yet


def test_a_local_target_accepts_what_the_form_sends():
    """Local visibility with push_main (the form's pair), and the PR rule does not apply."""
    sent = BuildOptionsInput.model_validate({
        "repo_name": None, "visibility": "local", "target": LOCAL,
        "advanced": {"delivery": "push_main", "license": "none", "topics": []},
    })  # fmt: skip
    options = resolve_options(sent, None, app_settings.BuildDefaults(), repo_name="paper-build")

    assert options.visibility == "local" and options.advanced.delivery == "push_main"
    assert options.repo_name is None
    assert branch_of(options) == "build/attention"
    assert (
        BuildOptionsInput.model_validate(
            {"visibility": "local", "target": LOCAL, "advanced": {"delivery": "pull_request"}}
        ).target
        is not None
    )


def test_a_github_target_defaults_to_a_pull_request_unless_push_main_is_sent():
    defaults = app_settings.BuildDefaults()  # delivery push_main in the settings
    default = resolve_options(BuildOptionsInput.model_validate({"target": GH}), None, defaults,
                              repo_name="x")  # fmt: skip
    asked = resolve_options(
        BuildOptionsInput.model_validate({"target": GH, "advanced": {"delivery": "push_main"}}),
        None, defaults, repo_name="x",
    )  # fmt: skip

    assert default.advanced.delivery == "pull_request"
    assert branch_of(default) == "build/attention"
    assert asked.advanced.delivery == "push_main"


def test_a_change_of_kind_starts_from_a_blank_target():
    current = BuildOptions.model_validate(
        {"target": GH, "advanced": {"delivery": "pull_request"}}
    ).model_dump(mode="json")
    given = BuildOptionsInput(target=BuildTargetInput.model_validate(LOCAL))

    merged = merge_options(current, given)

    assert merged.target.kind == "local" and merged.target.repo is None
    renamed = merge_options(current, BuildOptionsInput(
        target=BuildTargetInput(branch="feat/attention")))  # fmt: skip
    assert renamed.target.repo == "octo/site" and branch_of(renamed) == "feat/attention"


def test_a_new_repository_still_needs_its_name():
    with pytest.raises(ValidationError, match="repo_name"):
        BuildOptions.model_validate({"visibility": "private"})


def test_writes_are_scoped_to_the_folder_and_reads_stay_repo_wide():
    tools = allowed_tools(["Read", "Write", "Edit", "Glob"], [], False, folder="papers/a")

    assert tools[:4] == ["Read", "Write(papers/a/**)", "Edit(papers/a/**)", "Glob"]
    assert "Bash(git commit:*)" in tools

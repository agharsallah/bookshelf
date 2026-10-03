"""§7 options: references, advanced knobs and their sandbox checks, stored rows still valid."""

import re
import uuid

import pytest
from pydantic import ValidationError

from app.builds.toolchains import allowed_tools, extra_command_problem
from app.schemas.build_options import (
    BuildAdvanced,
    BuildAdvancedInput,
    BuildContextOptionsInput,
    BuildReference,
)
from app.schemas.builds import BuildOptions, BuildOptionsInput

PAPER_ID = uuid.uuid4()


def test_a_row_stored_before_section_7_still_validates_with_the_defaults():
    old = {"repo_name": "tiny", "visibility": "private", "owner": None,
           "claude_attribution": True, "link_paper": True, "stack": None,
           "allow_web": False}  # fmt: skip

    options = BuildOptions.model_validate(old)

    assert options.context.sections is None and options.references == []
    assert options.advanced == BuildAdvanced()
    assert options.advanced.delivery == "push_main" and options.advanced.push == "each_commit"


def test_attribution_is_off_unless_asked():
    assert BuildOptions(repo_name="tiny").claude_attribution is False


@pytest.mark.parametrize(
    "ref",
    [
        {"kind": "url", "url": "https://example.com/post", "title": "A post", "snapshot": True},
        {"kind": "shelf", "document_id": str(PAPER_ID), "title": "BERT", "note": "the encoder"},
    ],
)
def test_valid_references(ref: dict):
    assert BuildReference.model_validate(ref).title


@pytest.mark.parametrize(
    ("ref", "problem"),
    [
        ({"kind": "url", "title": "No link"}, "needs an http(s) `url`"),
        ({"kind": "url", "url": "ftp://x.org/f", "title": "FTP"}, "needs an http(s) `url`"),
        ({"kind": "url", "url": "https://x.org", "document_id": str(PAPER_ID), "title": "Both"},
         "has no `document_id`"),
        ({"kind": "shelf", "title": "Who?"}, "needs the paper's `document_id`"),
        ({"kind": "shelf", "document_id": str(PAPER_ID), "title": "BERT", "snapshot": True},
         "only a url reference can be snapshotted"),
        ({"kind": "url", "url": "https://x.org", "title": ""}, "at least 1 character"),
    ],
)  # fmt: skip
def test_invalid_references_say_why(ref: dict, problem: str):
    with pytest.raises(ValidationError, match=re.escape(problem)):
        BuildReference.model_validate(ref)


def test_at_most_twenty_references():
    ref = {"kind": "url", "url": "https://x.org", "title": "X"}
    with pytest.raises(ValidationError, match="at most 20"):
        BuildOptions.model_validate({"repo_name": "tiny", "references": [ref] * 21})


@pytest.mark.parametrize(
    "command", ["gh", "git", "git push", "rm", "rmdir", "curl", "wget", "r", "sudo", "sh"]
)
def test_extra_commands_that_reach_past_the_sandbox_are_refused(command: str):
    assert extra_command_problem(command) is not None
    with pytest.raises(ValidationError, match="is not allowed"):
        BuildAdvanced(extra_commands=[command])
    with pytest.raises(ValidationError, match="is not allowed"):
        BuildAdvancedInput(extra_commands=[command])


def test_extra_commands_follow_the_pattern_and_become_bash_patterns():
    advanced = BuildAdvanced(extra_commands=["make", "cargo test", "ruff"])
    tools = allowed_tools(["Read"], [], False, advanced.extra_commands)

    assert tools[-3:] == ["Bash(make:*)", "Bash(cargo test:*)", "Bash(ruff:*)"]
    for bad in ("Make", "make; rm -rf /", "a" * 42, "-x"):
        with pytest.raises(ValidationError):
            BuildAdvanced(extra_commands=[bad])


def test_argv_building_refuses_a_forbidden_extra_command_again():
    with pytest.raises(ValueError, match="not allowed"):
        allowed_tools(["Read"], [], False, ["git"])


@pytest.mark.parametrize(
    "bad",
    [{"topics": ["Has-Caps"]}, {"topics": ["x"] * 11}, {"description": "d" * 351},
     {"instructions": "i" * 4001}, {"model": "gpt"}, {"effort": "huge"},
     {"toolchains": ["rust"]}, {"license": "GPL"}],
)  # fmt: skip
def test_advanced_values_are_checked(bad: dict):
    with pytest.raises(ValidationError):
        BuildAdvanced.model_validate(bad)


def test_a_pull_request_needs_a_remote():
    with pytest.raises(ValidationError, match="local build has no GitHub"):
        BuildOptionsInput.model_validate(
            {"visibility": "local", "advanced": {"delivery": "pull_request"}}
        )
    with pytest.raises(ValidationError, match="local build has no GitHub"):
        BuildOptions.model_validate({"repo_name": "tiny", "visibility": "local",
                                     "advanced": {"delivery": "pull_request"}})  # fmt: skip


def test_partial_inputs_keep_only_what_was_sent():
    given = BuildOptionsInput.model_validate({
        "link_paper": False,
        "context": {"sections": None},
        "advanced": {"model": "sonnet", "instructions": None, "effort": None},
    })  # fmt: skip

    assert given.changes() == {
        "link_paper": False,
        "context": {"sections": None},  # null: back to every section
        "advanced": {"model": "sonnet", "instructions": None},  # effort: null means unset
    }
    assert BuildContextOptionsInput().changes() == {}

"""§7c B20, B21: the repository survey, from a real tmp git repo and from a fake GitHub."""

from pathlib import Path

from app.builds import survey as sv
from app.builds.github import FakeGitHub
from tests.builds.runner.conftest import commit_in, sh_git


def test_a_local_survey_reads_the_base_branch_not_the_working_tree(user_repo: Path) -> None:
    (user_repo / "README.md").write_text("# Uncommitted rewrite\n")  # the reader's own work
    (user_repo / "AGENTS.md").write_text("untracked\n")
    sh_git(user_repo, "checkout", "-q", "-b", "feature")
    commit_in(user_repo, "CLAUDE.md", "Feature-branch rules.\n", "docs: feature rules")

    survey = sv.survey_local(user_repo, base_branch="main", folder="papers/attention")

    assert survey.readme == "# Mine\n\nThe reader's project.\n"
    assert [(i.path, i.text) for i in survey.instructions] == [
        ("CLAUDE.md", "Use ruff. Tests go in tests/.\n")
    ]
    assert survey.tree == ["CLAUDE.md", "README.md", "pyproject.toml", "src/", "src/mine/"]
    assert survey.stack == ["Python (pyproject.toml)"] and survey.toolchains == ["python"]


def test_the_tree_stops_at_depth_two_and_200_entries() -> None:
    entries = [("blob", f"f{i:03}.txt") for i in range(250)] + [
        ("tree", "a"), ("tree", "a/b"), ("tree", "a/b/c"), ("blob", "a/b/c/d.py"),
    ]  # fmt: skip

    tree = sv.survey_tree(entries)

    assert len(tree) == sv.TREE_LIMIT
    assert "a/" in tree and "a/b/" in tree and not any(p.startswith("a/b/c") for p in tree)


def test_stack_detection_names_where_each_marker_is() -> None:
    labels, toolchains = sv.detect_stack(
        ["backend/pyproject.toml", "frontend/package.json", "frontend/astro.config.mjs",
         "pnpm-workspace.yaml", "Cargo.toml", "a/b/c/package.json"]
    )  # fmt: skip

    assert labels == [
        "Rust (Cargo.toml)", "pnpm workspace (monorepo) (pnpm-workspace.yaml)",
        "Python (backend/pyproject.toml)", "Astro (frontend/astro.config.mjs)",
        "Node (frontend/package.json)",
    ]  # fmt: skip
    assert toolchains == ["node", "python"]  # depth 4 is not looked at
    assert sv.detect_stack(["index.html", "style.css"]) == (
        ["Static site (index.html)"],
        ["static"],
    )


def test_instructions_come_from_the_root_and_the_folders_parents() -> None:
    files = {"CLAUDE.md", "papers/AGENTS.md", "papers/attention/CLAUDE.md", "other/CLAUDE.md",
             ".github/copilot-instructions.md"}  # fmt: skip

    assert sv.instruction_paths(files, "papers/attention") == [
        "CLAUDE.md",
        "papers/AGENTS.md",
        ".github/copilot-instructions.md",
    ]


def test_a_github_survey_goes_through_the_api_and_cuts_long_files() -> None:
    gh = FakeGitHub(
        trees={"octo/site": [("blob", "README.md"), ("blob", "package.json"),
                             ("tree", "docs"), ("blob", "docs/CLAUDE.md"),
                             ("blob", "AGENTS.md")]},
        files={("octo/site", "README.md"): "R" * 5000, ("octo/site", "AGENTS.md"): "Be brief.",
               ("octo/site", "docs/CLAUDE.md"): "docs rules"},
    )  # fmt: skip

    survey = sv.survey_github(gh, "octo/site", "main", folder="docs/attention")

    assert survey.readme is not None and len(survey.readme) == sv.README_CHARS
    assert [i.path for i in survey.instructions] == ["AGENTS.md", "docs/CLAUDE.md"]
    assert survey.toolchains == ["node"]


def test_the_markdown_carries_the_conventions_only_when_they_are_used(user_repo: Path) -> None:
    survey = sv.survey_local(user_repo, base_branch="main")
    kw = {"where": "octo/site", "base_branch": "main", "folder": "papers/attention"}

    used = sv.render_survey_md(survey, **kw)
    named = sv.render_survey_md(survey, instructions=False, **kw)

    assert used.startswith("# Repository\n\n`octo/site` at `main`.")
    assert "`papers/attention/`" in used and "- Python (pyproject.toml)" in used
    assert "## This repository's conventions" in used and "Use ruff." in used
    assert "Use ruff." not in named and "(not used for this build): `CLAUDE.md`" in named

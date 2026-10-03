import json
from types import SimpleNamespace

from app.builds.prompting import agent_argv, kickoff_prompt, settings_json
from app.builds.toolchains import allowed_tools

PLAN = {
    "summary": "A tiny transformer.",
    "stack": ["PyTorch"],
    "milestones": [{"title": "Attention", "commit": "feat(model): attention",
                    "deliverable": "attention.py", "done_when": "its test passes"}],
    "out_of_scope": ["multi-GPU"],
}  # fmt: skip
STOPS = {"max_minutes": 90, "max_commits": 30, "max_budget_usd": 5.0,
         "done_when": ["`uv run pytest` passes", "README explains how to train"]}  # fmt: skip
BUILD = SimpleNamespace(goal="A minimal PyTorch transformer.", options={"stack": "PyTorch"},
                        stops=STOPS)  # fmt: skip
SID = "2b1f6c1e-6a3b-4e55-9f0e-0c7e6f1b9a11"


def _argv(**overrides: object) -> list[str]:
    kwargs: dict = {
        "session_id": SID, "resume": False,
        "allowed_tools": allowed_tools(["Read", "Write", "Edit"], ["python"], False),
        "brief": "You build from papers.", "budget": None, "coauthor": False, "effort": "high",
    }  # fmt: skip
    kwargs.update(overrides)
    return agent_argv("claude", "opus", **kwargs)


def _after(argv: list[str], flag: str) -> str:
    return argv[argv.index(flag) + 1]


def test_kickoff_carries_goal_plan_stops_and_rules() -> None:
    prompt = kickoff_prompt(BUILD, PLAN, STOPS)
    assert "A minimal PyTorch transformer." in prompt
    assert "1. **Attention**, commit `feat(model): attention`" in prompt
    assert "at most 90 minutes" in prompt and "at most 30" in prompt and "$5.00" in prompt
    assert "  - `uv run pytest` passes" in prompt
    assert "Conventional Commit" in prompt and "Never push" in prompt
    assert "Run the code and its tests before every commit" in prompt
    assert "```json" in prompt and '"status": "goal_reached | partial | gave_up"' in prompt
    assert "multi-GPU" in prompt


def test_resume_prompt_restates_the_new_goal_only() -> None:
    prompt = kickoff_prompt(BUILD, PLAN, STOPS, resume_goal="Add a sampling script.")
    assert prompt.startswith("# Continue the build\n\nAdd a sampling script.")
    assert "1. **Attention**" not in prompt
    assert "never push" in prompt and "```json" in prompt


def test_argv_is_headless_locked_down_and_streams() -> None:
    argv = _argv()
    assert argv[:4] == ["claude", "-p", "--model", "opus"]
    assert _after(argv, "--effort") == "high"
    assert _after(argv, "--output-format") == "stream-json" and "--verbose" in argv
    assert _after(argv, "--session-id") == SID and "--resume" not in argv
    assert _after(argv, "--permission-mode") == "dontAsk"
    assert _after(argv, "--permission-prompts") == "none"
    assert "--safe-mode" in argv and "--strict-mcp-config" in argv
    assert _after(argv, "--append-system-prompt") == "You build from papers."
    assert "--max-budget-usd" not in argv


def test_allowlist_is_explicit_and_never_pushes() -> None:
    argv = _argv()
    start = argv.index("--allowedTools") + 1
    tools = argv[start : argv.index("--settings")]
    assert tools[:3] == ["Read", "Write", "Edit"]
    assert "Bash(git commit:*)" in tools and "Bash(uv:*)" in tools
    assert not any("push" in t or "gh" in t.split("(")[-1].split(" ")[0] for t in tools)
    assert "WebFetch" not in tools


def test_resume_and_budget() -> None:
    argv = _argv(resume=True, budget=2.5)
    assert _after(argv, "--resume") == SID and "--session-id" not in argv
    assert _after(argv, "--max-budget-usd") == "2.5"


def test_settings_follow_attribution() -> None:
    off = json.loads(_after(_argv(coauthor=False), "--settings"))
    on = json.loads(_after(_argv(coauthor=True), "--settings"))
    assert off == {"includeCoAuthoredBy": False, "attribution": {"commit": ""}}
    assert on == {"includeCoAuthoredBy": True}
    assert settings_json(coauthor=True) == '{"includeCoAuthoredBy":true}'


ADVANCED_BUILD = SimpleNamespace(
    goal="A minimal PyTorch transformer.",
    options={
        "stack": None,
        "references": [{"kind": "url", "url": "https://x.org", "title": "X", "snapshot": True}],
        "context": {"sections": None, "notes": "Prefer NumPy."},
        "advanced": {"commit_style": "small", "tests": "smoke", "license": "MIT",
                     "instructions": "Name the model `Gate`."},
    },
    stops=STOPS,
)  # fmt: skip


def test_kickoff_follows_the_advanced_workflow_and_points_at_the_readers_files() -> None:
    prompt = kickoff_prompt(ADVANCED_BUILD, PLAN, STOPS, branch="build/tiny")

    assert "in small commits" in prompt and "one fast smoke test" in prompt
    assert "Every milestone adds or extends a test" not in prompt
    assert "`docs/REFERENCES.md` lists the reader's references, their text under " \
           "`docs/references/`" in prompt  # fmt: skip
    assert "`docs/NOTES.md` holds the reader's notes" in prompt
    assert "`LICENSE` is the reader's choice" in prompt
    assert "You work on the branch `build/tiny`" in prompt
    extra = prompt.split("## Extra instructions from the reader\n\n")[1]
    assert extra.startswith("Name the model `Gate`.") and "```json" in extra


def test_kickoff_defaults_say_nothing_of_files_that_do_not_exist() -> None:
    prompt = kickoff_prompt(BUILD, PLAN, STOPS)

    assert "Every milestone adds or extends a test" in prompt
    for absent in ("REFERENCES.md", "NOTES.md", "LICENSE", "branch", "Extra instructions"):
        assert absent not in prompt


def test_kickoff_without_a_plan_says_it_comes_later() -> None:
    prompt = kickoff_prompt(BUILD, None, STOPS)
    assert "_The plan is drafted after you start" in prompt and "## Milestones" not in prompt


def test_tests_none_drops_the_test_rule() -> None:
    build = SimpleNamespace(goal="g", options={"advanced": {"tests": "none"}}, stops=STOPS)
    prompt = kickoff_prompt(build, PLAN, STOPS)
    assert "Write no\n  test suite" in prompt and "and its tests" not in prompt


def test_argv_refuses_a_forbidden_pattern_even_past_the_allowlist() -> None:
    import pytest

    with pytest.raises(ValueError, match="forbidden"):
        _argv(allowed_tools=["Read", "Bash(git push:*)"])

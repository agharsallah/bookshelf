"""`launch_spec`: model, effort and toolchain overrides; extra commands; the elided argv."""

import uuid

from app.builds.agents import load_agent
from app.builds.launch import BRIEF_PLACEHOLDER, elide_brief, launch_spec
from app.core.config import get_settings
from app.models import Build
from app.pipeline.models import cli_alias, cli_effort

PLAN = {"summary": "s", "stack": ["Python", "PyTorch"], "milestones": []}


def build(**advanced: object) -> Build:
    return Build(document_id=uuid.uuid4(), preset="minimal-implementation", goal="A tiny thing.",
                 options={"repo_name": "tiny", "advanced": advanced}, plan=PLAN,
                 stops={"max_minutes": 90, "max_commits": 30})  # fmt: skip


def after(argv: list[str], flag: str) -> str:
    return argv[argv.index(flag) + 1]


def test_auto_takes_the_agents_tier_defaults() -> None:
    agent, settings = load_agent(), get_settings()
    spec = launch_spec(build(), agent, settings, session_id="sid")

    assert spec.model == cli_alias(agent.tier, settings)
    assert spec.effort == cli_effort(agent.tier, settings).value
    assert after(spec.argv, "--model") == spec.model and after(spec.argv, "--effort") == spec.effort
    assert "Bash(uv:*)" in spec.allowed_tools  # the preset's python toolchain
    assert spec.branch is None


def test_overrides_reach_the_argv() -> None:
    spec = launch_spec(
        build(model="sonnet", effort="low", toolchains=["node"], extra_commands=["make"]),
        load_agent(), get_settings(), session_id="sid",
    )  # fmt: skip

    assert (after(spec.argv, "--model"), after(spec.argv, "--effort")) == ("sonnet", "low")
    assert spec.toolchains == ["node"] and "Bash(pnpm:*)" in spec.allowed_tools
    assert "Bash(uv:*)" not in spec.allowed_tools
    tools = spec.argv[spec.argv.index("--allowedTools") + 1 : spec.argv.index("--settings")]
    assert tools[-1] == "Bash(make:*)"


def test_pull_request_delivery_names_the_branch_and_the_brief_is_elided() -> None:
    spec = launch_spec(build(delivery="pull_request"), load_agent(), get_settings(),
                       session_id="sid")  # fmt: skip

    assert spec.branch == "build/tiny" and "`build/tiny`" in spec.prompt
    shown = elide_brief(spec.argv)
    assert after(shown, "--append-system-prompt") == BRIEF_PLACEHOLDER
    assert after(spec.argv, "--append-system-prompt") == load_agent().brief

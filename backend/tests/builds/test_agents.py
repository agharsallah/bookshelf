"""Agent packages and the agent's tool allowlist: what the agent may run, and what it never may."""

from collections.abc import Iterator
from pathlib import Path

import pytest

from app.builds.agents import AgentError, load_agent, read_agent
from app.builds.toolchains import (
    BASE_BASH,
    TOOLCHAINS,
    WEB_TOOLS,
    UnknownToolchainError,
    allowed_tools,
)
from app.models.enums import Tier


@pytest.fixture(autouse=True)
def _clean_tables() -> Iterator[None]:
    """No database here."""
    yield


AGENT_MD = "---\nname: toy\ndescription: A toy agent.\n---\n\n# Toy\n\nBuild it.\n"
META = "name: toy\nversion: 2\ndescription: Toy.\ntier: reason\nbase_tools: [Read, Write]\n"
PRESETS = """
- key: tiny
  label: Tiny
  description: The smallest thing.
  goal: Build the smallest thing that works.
  stack: Python
  toolchains: [python]
  stops: {max_minutes: 30, done_when: [tests pass]}
"""


def package(root: Path, *, meta: str = META, presets: str = PRESETS, agent: str = AGENT_MD) -> Path:
    folder = root / "toy"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "meta.yaml").write_text(meta)
    (folder / "presets.yaml").write_text(presets)
    (folder / "AGENT.md").write_text(agent)
    return folder


def test_a_package_loads_with_its_frontmatter_stripped(tmp_path: Path):
    agent = read_agent(package(tmp_path))

    assert (agent.name, agent.version, agent.tier) == ("toy", "2", Tier.REASON)
    assert agent.base_tools == ("Read", "Write")
    assert agent.brief == "# Toy\n\nBuild it."
    (preset,) = agent.presets
    assert preset.toolchains == ("python",)
    assert preset.stops == {"max_minutes": 30, "done_when": ["tests pass"]}
    assert agent.preset("tiny") is preset and agent.preset("nope") is None


@pytest.mark.parametrize(
    ("change", "reason"),
    [
        ({"presets": PRESETS.replace("[python]", "[cobol]")}, "unknown toolchain"),
        ({"presets": PRESETS + "  colour: red\n"}, "colour"),
        ({"presets": PRESETS + PRESETS}, "unique"),
        ({"agent": "# no frontmatter"}, "frontmatter"),
        ({"meta": META.replace("name: toy", "name: other")}, "name the folder"),
        ({"meta": META + "effort: high\n"}, "effort"),
    ],
)
def test_a_package_off_contract_is_refused(tmp_path: Path, change: dict[str, str], reason: str):
    with pytest.raises(AgentError, match=reason):
        read_agent(package(tmp_path, **change))


def test_the_real_build_from_paper_package_loads():
    agent = load_agent()

    assert agent.name == "build-from-paper"
    assert agent.brief and not agent.brief.startswith("---")
    assert agent.presets, "presets.yaml lists the presets the form offers"
    assert all(set(p.toolchains) <= set(TOOLCHAINS) for p in agent.presets)
    assert load_agent() is agent  # cached per process


def test_allowed_tools_adds_the_toolchains_and_the_web_only_when_asked():
    tools = allowed_tools(("Read", "Edit"), ["python", "node"], allow_web=False)

    assert tools[:2] == ["Read", "Edit"]
    assert set(BASE_BASH) | set(TOOLCHAINS["python"]) | set(TOOLCHAINS["node"]) <= set(tools)
    assert not set(WEB_TOOLS) & set(tools)
    assert set(WEB_TOOLS) <= set(allowed_tools((), [], allow_web=True))


def test_allowed_tools_never_lets_the_agent_reach_github_or_delete():
    every = allowed_tools(("Read",), list(TOOLCHAINS), allow_web=True)

    for pattern in every:
        assert "push" not in pattern and "gh" not in pattern.split("(")[-1].split(" ")[0]
        assert "curl" not in pattern and "rm -rf" not in pattern


def test_an_unknown_toolchain_or_a_forbidden_tool_is_refused():
    with pytest.raises(UnknownToolchainError):
        allowed_tools((), ["cobol"], allow_web=False)
    with pytest.raises(ValueError, match="forbidden"):
        allowed_tools(("Bash(git push:*)",), [], allow_web=False)

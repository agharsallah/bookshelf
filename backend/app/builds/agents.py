"""Agent packages (docs/BUILDS.md B3): `agents/<name>/` holds what an agentic run needs.

    meta.yaml     name, version, description, tier, base_tools
    AGENT.md      YAML frontmatter (name, description), then the system prompt (`brief`)
    presets.yaml  a list of {key, label, description, goal, stack, toolchains, stops}

Loaded once per process (`load_agent` is cached); every preset's toolchains must exist in
`toolchains.TOOLCHAINS`, and unknown keys are refused, so a typo fails loudly.
"""

import re
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Annotated, Any

import yaml
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    ValidationError,
    field_validator,
)

from app.builds.toolchains import TOOLCHAINS
from app.core.config import REPO_ROOT
from app.models.enums import Tier

DEFAULT_AGENT = "build-from-paper"
AGENTS_DIR = REPO_ROOT / "agents"
_FRONTMATTER = re.compile(r"\A\s*---[ \t]*\n(.*?)\n---[ \t]*(?:\n|\Z)", re.DOTALL)


class AgentError(ValueError):
    """A package that is missing or does not match the contract."""


@dataclass(frozen=True, slots=True)
class Preset:
    key: str
    label: str
    description: str
    goal: str
    stack: str | None
    toolchains: tuple[str, ...]
    stops: dict[str, Any]  # a Partial<BuildStops>


@dataclass(frozen=True, slots=True)
class AgentPackage:
    name: str
    version: str
    description: str
    tier: Tier
    base_tools: tuple[str, ...]
    brief: str  # AGENT.md body, frontmatter removed: the appended system prompt
    presets: tuple[Preset, ...]

    def preset(self, key: str | None) -> Preset | None:
        return next((p for p in self.presets if p.key == key), None) if key else None


# --- file shapes ----------------------------------------------------------------------

_Key = Annotated[str, StringConstraints(pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$", max_length=100)]


class _Meta(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: _Key
    version: str
    description: str
    tier: Tier
    base_tools: list[Annotated[str, StringConstraints(min_length=1)]]

    @field_validator("version", mode="before")
    @classmethod
    def _version_as_text(cls, value: object) -> object:
        return str(value) if isinstance(value, int) else value


class _Stops(BaseModel):
    model_config = ConfigDict(extra="forbid")

    max_minutes: Annotated[int, Field(ge=5, le=720)] | None = None
    max_commits: Annotated[int, Field(ge=1, le=200)] | None = None
    max_budget_usd: Annotated[float, Field(ge=0.5, le=200)] | None = None
    done_when: list[Annotated[str, StringConstraints(max_length=300)]] | None = Field(
        default=None, max_length=10
    )


class _Preset(BaseModel):
    model_config = ConfigDict(extra="forbid")

    key: _Key
    label: Annotated[str, StringConstraints(min_length=1, max_length=80)]
    description: str
    goal: Annotated[str, StringConstraints(min_length=10, max_length=4000)]
    stack: str | None = None
    toolchains: list[str] = Field(default_factory=list)
    stops: _Stops = Field(default_factory=_Stops)


# --- loading ----------------------------------------------------------------------------


def _yaml(path: Path) -> Any:
    try:
        return yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as exc:
        raise AgentError(f"{path.parent.name}/{path.name}: {exc}") from exc


def split_frontmatter(text: str) -> tuple[dict[str, Any], str]:
    """AGENT.md as (frontmatter, body). Raises `AgentError` without frontmatter."""
    match = _FRONTMATTER.match(text)
    if match is None:
        raise AgentError("AGENT.md needs YAML frontmatter (name, description)")
    front = yaml.safe_load(match.group(1)) or {}
    if not isinstance(front, dict) or not front.get("name") or not front.get("description"):
        raise AgentError("AGENT.md frontmatter needs name and description")
    return front, text[match.end() :].strip()


def _preset(raw: Any) -> Preset:
    parsed = _Preset.model_validate(raw)
    if unknown := [t for t in parsed.toolchains if t not in TOOLCHAINS]:
        raise AgentError(f"preset {parsed.key!r}: unknown toolchain {unknown[0]!r}")
    return Preset(
        key=parsed.key,
        label=parsed.label,
        description=parsed.description,
        goal=parsed.goal,
        stack=parsed.stack,
        toolchains=tuple(dict.fromkeys(parsed.toolchains)),
        stops=parsed.stops.model_dump(exclude_none=True),
    )


def read_agent(directory: Path) -> AgentPackage:
    """Load and check one package (uncached). Raises `AgentError` with the reason."""
    try:
        meta = _Meta.model_validate(_yaml(directory / "meta.yaml"))
        raw_presets = _yaml(directory / "presets.yaml") or []
        if not isinstance(raw_presets, list):
            raise AgentError("presets.yaml must be a list")
        presets = tuple(_preset(p) for p in raw_presets)
        front, brief = split_frontmatter((directory / "AGENT.md").read_text(encoding="utf-8"))
    except ValidationError as exc:
        raise AgentError(f"{directory.name}: {exc}") from exc
    except OSError as exc:
        raise AgentError(f"{directory.name}: {exc}") from exc
    if meta.name != directory.name or front["name"] != directory.name:
        raise AgentError(f"{directory.name}: meta.yaml and AGENT.md must name the folder")
    keys = [p.key for p in presets]
    if len(keys) != len(set(keys)):
        raise AgentError(f"{directory.name}: preset keys must be unique")
    return AgentPackage(
        name=meta.name,
        version=meta.version,
        description=meta.description,
        tier=meta.tier,
        base_tools=tuple(meta.base_tools),
        brief=brief,
        presets=presets,
    )


@cache
def load_agent(name: str = DEFAULT_AGENT, root: Path = AGENTS_DIR) -> AgentPackage:
    """The package `root/name`, read once per process."""
    if not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", name):
        raise AgentError(f"not an agent name: {name!r}")
    return read_agent(root / name)

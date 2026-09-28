"""Skill packages (D5): load `skills/<name>/{meta.yaml,SKILL.md,schema.json}` and render prompts.

The contract lives in `skills/README.md`. One SKILL.md serves two entry points: Claude Code
reads it as an interactive skill; the batch runner strips the frontmatter and the
`<!-- interactive:start/end -->` section, then appends `## Input` and the selector JSON.
"""

import itertools
import json
import logging
import re
import string
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, Any, Literal

import yaml
from jsonschema import Draft202012Validator
from jsonschema.exceptions import SchemaError
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

from app.models.enums import ArtifactType, JobKind, Tier

logger = logging.getLogger(__name__)

_FRONTMATTER = re.compile(r"\A\s*---[ \t]*\n.*?\n---[ \t]*(?:\n|\Z)", re.DOTALL)
_INTERACTIVE = re.compile(
    r"<!--\s*interactive:start\s*-->.*?<!--\s*interactive:end\s*-->[ \t]*\n?", re.DOTALL
)

Scope = Literal["document", "chapter", "section", "block", "note"]
ParamValue = str | int


class SkillError(ValueError):
    """A skill package that does not satisfy the contract."""


class ParamError(ValueError):
    """Run parameters a skill does not declare, or a value outside a parameter's choices."""

    def __init__(self, message: str, *, param: str | None = None) -> None:
        super().__init__(message)
        self.param = param


class ParamSpec(BaseModel):
    """One run parameter (`meta.yaml` `params`): a closed set of choices and a default."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    choices: Annotated[tuple[ParamValue, ...], Field(min_length=1)]
    default: ParamValue
    description: str = ""

    @model_validator(mode="after")
    def _default_is_a_choice(self) -> "ParamSpec":
        if self.default not in self.choices:
            raise ValueError(f"default {self.default!r} is not one of {list(self.choices)}")
        return self


class GateConfig(BaseModel):
    """Per-skill thresholds for the §14 gates."""

    model_config = ConfigDict(extra="ignore", frozen=True)

    grounding_min: Annotated[float, Field(ge=0, le=1)] = 0.9
    compression: tuple[float, float] | None = None
    # Below this many source words the band's upper edge is not checked: a faithful note of
    # a 70-word conclusion cannot be much shorter than it. None: always checked.
    compression_min_source: Annotated[int | None, Field(ge=1)] = None
    max_words: Annotated[int | None, Field(ge=1)] = None
    # Book-wide runs: share of the input's chapters the output must cite at least once.
    # Only checked when the selector reports the chapters it offered (`Selection.chapters`).
    coverage_min: Annotated[float | None, Field(ge=0, le=1)] = None
    # Spoken output (a run with a `minutes` param): spoken words per minute the output must
    # land between, so a "15 minute" script lasts about 15 minutes. Outside → a flag.
    words_per_minute: tuple[float, float] | None = None
    # Quoting output (leaf spans copied from the source): each span's text must be found in
    # the block it cites, whitespace and typographic quotes aside. Missing → a flag.
    verbatim: bool = False


class SkillMeta(BaseModel):
    """`meta.yaml`. `job_kind` is absent for interactive-only skills (parse-outline)."""

    model_config = ConfigDict(extra="ignore", frozen=True)

    name: str
    version: str
    description: str = ""
    tier: Tier
    job_kind: JobKind | None = None
    artifact_type: ArtifactType | None = None
    scope: Scope
    selector: str
    # A chapter-scope skill that can also run on the whole book: the selector it reads
    # when a job names no anchor (and no note). None: the skill has one scope only.
    document_selector: str | None = None
    # The model tier for those book-wide runs, when it differs from `tier`: synthesising a
    # whole book's distillations is a harder job than one chapter's. None: `tier`.
    document_tier: Tier | None = None
    vision: bool = False
    gates: GateConfig = Field(default_factory=GateConfig)
    # Run parameters, chosen per job (`POST /jobs` `params`): part of the input (so of
    # `input_hash`), shown to the skill as `inputs.params`. `variant` names the episode a
    # run makes from them (`"{minutes}m-{format}"`), so each set keeps its own versions.
    params: dict[str, ParamSpec] = Field(default_factory=dict)
    variant: str | None = None
    # The artifact is a script to be spoken: storing one queues a `narrate` job (app/audio).
    narrate: bool = False

    @model_validator(mode="after")
    def _variant_names_params(self) -> "SkillMeta":
        if bool(self.params) != (self.variant is not None):
            raise ValueError("`params` and `variant` come together")
        if self.variant is not None:
            fields = {f for _, f, _, _ in string.Formatter().parse(self.variant) if f}
            if not fields or not fields <= set(self.params):
                raise ValueError(f"variant {self.variant!r} must name only declared params")
        return self

    def resolve_params(self, raw: Mapping[str, object] | None) -> dict[str, ParamValue]:
        """Every declared param, from `raw` or its default. Raises `ParamError`."""
        raw = raw or {}
        unknown = sorted(set(raw) - set(self.params))
        if unknown:
            raise ParamError(f"{self.name} takes no param {unknown[0]!r}", param=unknown[0])
        resolved: dict[str, ParamValue] = {}
        for name, spec in self.params.items():
            value = raw.get(name, spec.default)
            # By its text, so a query string's "15" picks the choice 15; never a bool.
            match = next((c for c in spec.choices if str(c) == str(value)), None)
            if match is None or isinstance(value, bool):
                choices = ", ".join(str(c) for c in spec.choices)
                raise ParamError(f"{name} must be one of {choices}, got {value!r}", param=name)
            resolved[name] = match
        return resolved

    def variant_of(self, params: Mapping[str, ParamValue]) -> str | None:
        """The episode key for resolved `params` (`15m-conversation-en`), or None."""
        return self.variant.format(**params) if self.variant is not None else None

    def params_of(self, variant: str | None) -> dict[str, ParamValue] | None:
        """The params an episode key was made from (the inverse of `variant_of`), or None
        when no combination of choices makes it. Choices are few, so this tries them all."""
        if variant is None or self.variant is None:
            return None
        names = list(self.params)
        for combo in itertools.product(*(self.params[n].choices for n in names)):
            params = dict(zip(names, combo, strict=True))
            if self.variant_of(params) == variant:
                return params
        return None

    def selector_for(self, anchor: str | None, note_id: uuid.UUID | None = None) -> str:
        """The selector for one run: book-wide when there is no anchor to scope it."""
        if anchor is None and note_id is None and self.document_selector is not None:
            return self.document_selector
        return self.selector

    def tier_for(self, anchor: str | None, note_id: uuid.UUID | None = None) -> Tier:
        """The tier for one run: `document_tier` when it runs book-wide (see `selector_for`)."""
        if self.selector_for(anchor, note_id) == self.document_selector and self.document_tier:
            return self.document_tier
        return self.tier

    @field_validator("version", mode="before")
    @classmethod
    def _version_as_text(cls, value: object) -> object:
        return str(value) if isinstance(value, int) else value

    @field_validator("gates", mode="before")
    @classmethod
    def _null_gates(cls, value: object) -> object:
        return {} if value is None else value


@dataclass(frozen=True, slots=True)
class Skill:
    meta: SkillMeta
    directory: Path
    prompt: str  # SKILL.md, verbatim
    schema: dict[str, Any]

    @property
    def name(self) -> str:
        return self.meta.name

    @property
    def version(self) -> str:
        return self.meta.version


def load_skill(directory: Path) -> Skill:
    """Load and check one package. Raises `SkillError` with the reason."""
    try:
        raw_meta = yaml.safe_load((directory / "meta.yaml").read_text(encoding="utf-8"))
        prompt = (directory / "SKILL.md").read_text(encoding="utf-8")
        schema = json.loads((directory / "schema.json").read_text(encoding="utf-8"))
        meta = SkillMeta.model_validate(raw_meta)
        Draft202012Validator.check_schema(schema)
    except (OSError, yaml.YAMLError, json.JSONDecodeError, ValidationError, SchemaError) as exc:
        raise SkillError(f"{directory.name}: {exc}") from exc
    if meta.name != directory.name:
        raise SkillError(f"{directory.name}: meta.yaml name is {meta.name!r}")
    if meta.job_kind is not None and meta.artifact_type is None:
        raise SkillError(f"{directory.name}: a job-backed skill needs an artifact_type")
    return Skill(meta=meta, directory=directory, prompt=prompt, schema=schema)


def load_catalogue(skills_dir: Path) -> dict[str, Skill]:
    """Every valid package under `skills_dir`, by name. Broken ones are logged and skipped,
    so one malformed skill cannot stop the worker from running the others."""
    catalogue: dict[str, Skill] = {}
    if not skills_dir.is_dir():
        return catalogue
    for directory in sorted(p for p in skills_dir.iterdir() if (p / "meta.yaml").is_file()):
        try:
            skill = load_skill(directory)
        except SkillError as exc:
            logger.warning("Skipping invalid skill package", extra={"error": str(exc)})
            continue
        catalogue[skill.name] = skill
    return catalogue


def skill_for_job_kind(catalogue: dict[str, Skill], kind: JobKind) -> Skill | None:
    """The skill that runs a stage. `derive` names its skill per job instead."""
    if kind is JobKind.DERIVE:
        return None
    matches = [s for s in catalogue.values() if s.meta.job_kind is kind]
    if len(matches) > 1:
        logger.warning(
            "Several skills claim one job kind; using the first",
            extra={"job_kind": kind.value, "skills": [s.name for s in matches]},
        )
    return matches[0] if matches else None


def skill_for_artifact_type(catalogue: Mapping[str, Skill], kind: ArtifactType) -> Skill | None:
    return next((s for s in catalogue.values() if s.meta.artifact_type is kind), None)


def batch_prompt(skill_md: str) -> str:
    """SKILL.md without the frontmatter and the interactive-only section."""
    body = _FRONTMATTER.sub("", skill_md, count=1)
    return _INTERACTIVE.sub("", body).strip()


def render_prompt(skill_md: str, inputs: dict[str, Any]) -> str:
    """The exact prompt piped to `claude -p`: method + hard rules + the input JSON."""
    payload = json.dumps(inputs, indent=2, ensure_ascii=False, default=str)
    return f"{batch_prompt(skill_md)}\n\n## Input\n\n{payload}\n"

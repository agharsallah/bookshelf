"""The context, references and advanced options of a build (docs/BUILDS.md §7).

Every model here is a part of `BuildOptions` (stored in `builds.options`, jsonb) with
defaults, so rows written before §7 existed still validate. The `*Input` forms are the
partial versions a form or an approve sends: `changes()` gives the fields sent, keeping a
`null` only where it means something (`sections: null` is "all of them").
"""

import uuid
from typing import Annotated, Any, ClassVar, Literal, get_args

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from app.builds.toolchains import extra_command_problem

ContextSectionKey = Literal[
    "tldr", "question", "core_ideas", "how_it_works", "equations",
    "setup", "results", "claims", "limitations",
]  # fmt: skip
SECTION_KEYS: tuple[str, ...] = get_args(ContextSectionKey)

ModelChoice = Literal["auto", "haiku", "sonnet", "opus"]
EffortChoice = Literal["auto", "low", "medium", "high", "xhigh", "max"]
ToolchainChoice = Literal["python", "node", "static"]
CommitStyle = Literal["milestone", "small"]
TestsPolicy = Literal["each_milestone", "smoke", "none"]
License = Literal["none", "MIT", "Apache-2.0"]
Delivery = Literal["push_main", "pull_request"]
PushPolicy = Literal["each_commit", "at_end"]

Notes = Annotated[str, StringConstraints(max_length=8000)]
Instructions = Annotated[str, StringConstraints(max_length=4000)]
Description = Annotated[str, StringConstraints(max_length=350)]
Topic = Annotated[str, StringConstraints(pattern=r"^[a-z0-9][a-z0-9-]{0,49}$")]
ExtraCommand = Annotated[str, StringConstraints(pattern=r"^[a-z0-9][a-z0-9 ._-]{0,40}$")]
Topics = Annotated[list[Topic], Field(max_length=10)]
ExtraCommands = Annotated[list[ExtraCommand], Field(max_length=10)]
Sections = Annotated[list[ContextSectionKey], Field(max_length=len(SECTION_KEYS))]
MAX_REFERENCES = 20


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class _Partial(_Strict):
    """A partial form: `changes()` is what was sent, a null kept only for `NULLABLE`."""

    NULLABLE: ClassVar[frozenset[str]] = frozenset()

    def changes(self) -> dict[str, Any]:
        sent = self.model_dump(mode="json", exclude_unset=True)
        return {k: v for k, v in sent.items() if v is not None or k in self.NULLABLE}


def _check_commands(commands: list[str]) -> list[str]:
    """Each extra command must stay inside the sandbox (B14); a clear 422 otherwise."""
    for command in commands:
        if problem := extra_command_problem(command):
            raise ValueError(problem)
    return commands


# --- context ------------------------------------------------------------------------------


class BuildContextOptions(_Strict):
    sections: Sections | None = None  # null: every section
    notes: Notes | None = None


class BuildContextOptionsInput(_Partial):
    NULLABLE: ClassVar[frozenset[str]] = frozenset({"sections", "notes"})

    sections: Sections | None = None
    notes: Notes | None = None


# --- references ---------------------------------------------------------------------------


class BuildReference(_Strict):
    """A link (`url`, optionally snapshotted at seed time) or a paper on the shelf."""

    kind: Literal["url", "shelf"]
    url: Annotated[str, StringConstraints(max_length=2000)] | None = None
    document_id: uuid.UUID | None = None
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
    note: Annotated[str, StringConstraints(max_length=500)] | None = None
    snapshot: bool = False

    @model_validator(mode="after")
    def _fits_its_kind(self) -> "BuildReference":
        if self.kind == "url":
            if not self.url or not self.url.lower().startswith(("http://", "https://")):
                raise ValueError("a url reference needs an http(s) `url`")
            if self.document_id is not None:
                raise ValueError("a url reference has no `document_id`")
        else:
            if self.document_id is None:
                raise ValueError("a shelf reference needs the paper's `document_id`")
            if self.snapshot:
                raise ValueError("only a url reference can be snapshotted")
            if self.url is not None:
                raise ValueError("a shelf reference has no `url`")
        return self


References = Annotated[list[BuildReference], Field(max_length=MAX_REFERENCES)]


# --- advanced -----------------------------------------------------------------------------


class BuildAdvanced(_Strict):
    """The knobs the defaults hide; every default is what a build did before §7."""

    model: ModelChoice = "auto"  # auto: the agent's tier
    effort: EffortChoice = "auto"
    plan_model: ModelChoice = "auto"  # for the plan-build run
    toolchains: Annotated[list[ToolchainChoice], Field(max_length=3)] | None = None
    extra_commands: ExtraCommands = Field(default_factory=list)
    instructions: Instructions | None = None
    commit_style: CommitStyle = "milestone"
    tests: TestsPolicy = "each_milestone"
    license: License = "none"
    delivery: Delivery = "push_main"
    push: PushPolicy = "each_commit"
    description: Description | None = None
    topics: Topics = Field(default_factory=list)

    @model_validator(mode="after")
    def _safe_commands(self) -> "BuildAdvanced":
        _check_commands(self.extra_commands)
        return self


class BuildAdvancedInput(_Partial):
    NULLABLE: ClassVar[frozenset[str]] = frozenset({"toolchains", "instructions", "description"})

    model: ModelChoice | None = None
    effort: EffortChoice | None = None
    plan_model: ModelChoice | None = None
    toolchains: Annotated[list[ToolchainChoice], Field(max_length=3)] | None = None
    extra_commands: ExtraCommands | None = None
    instructions: Instructions | None = None
    commit_style: CommitStyle | None = None
    tests: TestsPolicy | None = None
    license: License | None = None
    delivery: Delivery | None = None
    push: PushPolicy | None = None
    description: Description | None = None
    topics: Topics | None = None

    @model_validator(mode="after")
    def _safe_commands(self) -> "BuildAdvancedInput":
        _check_commands(self.extra_commands or [])
        return self


# The advanced fields the settings hold a default for (docs/BUILDS.md §7, Settings).
ADVANCED_DEFAULT_FIELDS = (
    "model", "effort", "plan_model", "commit_style", "tests", "license", "delivery", "push",
)  # fmt: skip

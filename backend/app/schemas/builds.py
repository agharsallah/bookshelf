"""Wire shapes of builds (docs/BUILDS.md §3, §4, §7). The jsonb columns of `builds` are
stored as these models dump, so the service validates every write through them. The §7
option parts (context, references, advanced) live in `app.schemas.build_options`."""

import uuid
from datetime import UTC, datetime
from typing import Annotated, Any, Literal, Self

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    computed_field,
    model_validator,
)

from app.models.build import BuildState, BuildVisibility, StopReason
from app.models.enums import Origin
from app.schemas.build_options import (
    BuildAdvanced,
    BuildAdvancedInput,
    BuildContextOptions,
    BuildContextOptionsInput,
    References,
)
from app.schemas.build_target import BuildTarget, BuildTargetInput

RepoName = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9._-]{1,100}$")]
Owner = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9-]{1,39}$")]
DoneWhen = Annotated[
    list[Annotated[str, StringConstraints(min_length=1, max_length=300)]], Field(max_length=10)
]
MaxMinutes = Annotated[int, Field(ge=5, le=720)]
MaxCommits = Annotated[int, Field(ge=1, le=200)]
MaxBudget = Annotated[float, Field(ge=0.5, le=200)]
Goal = Annotated[str, StringConstraints(strip_whitespace=True, min_length=10, max_length=4000)]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# --- options and stops ------------------------------------------------------------------


PR_LOCAL = "a local build has no GitHub repository: `delivery: pull_request` needs a remote"
NO_REPO_NAME = "a new repository needs a `repo_name`"
PR_PREFIX = "Pull request: "  # the `system` event the runner adds once it opened the PR


class BuildOptions(_Strict):
    """Stored in `builds.options`. The §7 and §7c parts have defaults: older rows lack them.

    For an existing repository (`target.kind` github or local, §7c) the fields that only
    describe a new one are normalized out on every validation: `repo_name`, `owner`,
    `advanced.description` and `.topics` are cleared, `advanced.license` is `none`, and
    `visibility` is `local` for a local target and `private` for a GitHub one (nothing reads
    it there). A local target always works on its branch and opens no pull request, so its
    `delivery` is normalized to `push_main` and never read."""

    repo_name: RepoName | None = None
    visibility: BuildVisibility = BuildVisibility.PRIVATE
    owner: Owner | None = None
    claude_attribution: bool = False
    link_paper: bool = True
    stack: Annotated[str, StringConstraints(max_length=200)] | None = None
    allow_web: bool = False
    context: BuildContextOptions = Field(default_factory=BuildContextOptions)
    references: References = Field(default_factory=list)
    advanced: BuildAdvanced = Field(default_factory=BuildAdvanced)
    target: BuildTarget = Field(default_factory=BuildTarget)

    @model_validator(mode="after")
    def _fits_the_target(self) -> "BuildOptions":
        if not self.target.existing:
            if self.repo_name is None:
                raise ValueError(NO_REPO_NAME)
            if (
                self.visibility is BuildVisibility.LOCAL
                and self.advanced.delivery == "pull_request"
            ):
                raise ValueError(PR_LOCAL)
            return self
        local = self.target.kind == "local"
        self.repo_name, self.owner = None, None
        self.visibility = BuildVisibility.LOCAL if local else BuildVisibility.PRIVATE
        self.advanced = self.advanced.model_copy(update={
            "description": None, "topics": [], "license": "none",
            **({"delivery": "push_main"} if local else {}),
        })  # fmt: skip
        return self


class BuildOptionsInput(_Strict):
    """Options as asked for: anything left out comes from the settings and the preset; a
    blank `repo_name` takes the plan's suggestion at approve."""

    repo_name: RepoName | Literal[""] | None = None
    visibility: BuildVisibility | None = None
    owner: Owner | None = None
    claude_attribution: bool | None = None
    link_paper: bool | None = None
    stack: Annotated[str, StringConstraints(max_length=200)] | None = None
    allow_web: bool | None = None
    context: BuildContextOptionsInput | None = None
    references: References | None = None  # replaces the list when sent
    advanced: BuildAdvancedInput | None = None
    target: BuildTargetInput | None = None

    @model_validator(mode="after")
    def _pr_needs_a_remote(self) -> "BuildOptionsInput":
        delivery = self.advanced.delivery if self.advanced else None
        existing = self.target is not None and self.target.kind in ("github", "local")
        if self.visibility is BuildVisibility.LOCAL and delivery == "pull_request" and not existing:
            raise ValueError(PR_LOCAL)
        return self

    def changes(self) -> dict[str, Any]:
        """What was sent: plain fields when not null, the nested parts as their own
        `changes()` (merged key by key over what a build already has)."""
        nested = {"context", "advanced", "target"}
        plain = self.model_dump(mode="json", exclude_none=True, exclude=nested | {"references"})
        out: dict[str, Any] = dict(plain)
        if self.references is not None:
            out["references"] = [r.model_dump(mode="json") for r in self.references]
        for key in nested:
            part = getattr(self, key)
            if part is not None:
                out[key] = part.changes()
        return out


class BuildStops(_Strict):
    max_minutes: MaxMinutes = 90
    max_commits: MaxCommits = 30
    max_budget_usd: MaxBudget | None = None
    done_when: DoneWhen = Field(default_factory=list)


class BuildStopsInput(_Strict):
    """Stops as asked for; unset ones come from the preset, then the settings."""

    max_minutes: MaxMinutes | None = None
    max_commits: MaxCommits | None = None
    max_budget_usd: MaxBudget | None = None
    done_when: DoneWhen | None = None


# --- plan, events, report ---------------------------------------------------------------


class Milestone(_Strict):
    title: Annotated[str, StringConstraints(min_length=1, max_length=80)]
    commit: Annotated[str, StringConstraints(min_length=1, max_length=100)]
    deliverable: Annotated[str, StringConstraints(min_length=1, max_length=500)]
    done_when: Annotated[str, StringConstraints(min_length=1, max_length=300)]


class LayoutEntry(_Strict):
    path: Annotated[str, StringConstraints(min_length=1, max_length=200)]
    purpose: Annotated[str, StringConstraints(max_length=300)]


class BuildPlan(_Strict):
    """skills/plan-build/schema.json; a human edit is checked against this shape."""

    summary: Annotated[str, StringConstraints(min_length=1, max_length=800)]
    stack: Annotated[list[str], Field(min_length=1, max_length=12)]
    repo_name: RepoName
    milestones: Annotated[list[Milestone], Field(min_length=3, max_length=12)]
    layout: Annotated[list[LayoutEntry], Field(min_length=1, max_length=40)]
    out_of_scope: list[str] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)
    questions: list[str] = Field(default_factory=list)


class BuildEvent(BaseModel):
    at: datetime
    kind: Literal["text", "tool", "commit", "system", "error"]
    text: str


class BuildCommit(BaseModel):
    sha: str
    subject: str
    at: datetime


class BuildReport(BaseModel):
    status: Literal["goal_reached", "partial", "gave_up"]
    done: list[str] = Field(default_factory=list)
    not_done: list[str] = Field(default_factory=list)
    next_steps: list[str] = Field(default_factory=list)
    run_it: str = ""


# --- requests ---------------------------------------------------------------------------


class BuildCreate(_Strict):
    goal: Goal
    preset: Annotated[str, StringConstraints(max_length=100)] | None = None
    options: BuildOptionsInput = Field(default_factory=BuildOptionsInput)
    stops: BuildStopsInput = Field(default_factory=BuildStopsInput)


class PlanUpdate(_Strict):
    plan: BuildPlan


class Replan(_Strict):
    feedback: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)
    ]


class Approve(_Strict):
    options: BuildOptionsInput | None = None
    stops: BuildStopsInput | None = None


class Continue(_Strict):
    goal: Goal | None = None
    stops: BuildStopsInput = Field(default_factory=BuildStopsInput)


# --- responses --------------------------------------------------------------------------


class BuildSummary(BaseModel):
    """A list row: everything but the plan, the events and the report."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    document_id: uuid.UUID
    agent: str
    preset: str | None
    goal: str
    options: BuildOptions
    stops: BuildStops
    plan_origin: Origin | None
    plan_version: Annotated[
        int | None, Field(description="The plan version `plan` is (§7b); null before one.")
    ]
    plan_versions_count: Annotated[int, Field(ge=0, description="How many plan versions.")]
    plan_feedback: str | None
    state: BuildState
    stop_reason: StopReason | None
    stop_requested: bool
    repo_url: str | None
    commits: list[BuildCommit]
    cost_usd: float | None
    error: str | None
    plan_job_id: uuid.UUID | None
    run_job_id: uuid.UUID | None
    started_at: datetime | None
    finished_at: datetime | None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(cls, build: Any, *, plan_versions_count: int) -> Self:
        """From a `Build` row plus its version count, which the row does not carry."""
        return cls.model_validate(
            {**build.model_dump(), "plan_versions_count": plan_versions_count}
        )

    @computed_field  # type: ignore[prop-decorator]
    @property
    def elapsed_seconds(self) -> int | None:
        """Since the run started: until it finished, else until now."""
        if self.started_at is None:
            return None
        end = self.finished_at or datetime.now(UTC)
        return max(0, int((end - self.started_at).total_seconds()))


class BuildPublic(BuildSummary):
    plan: BuildPlan | None
    events: list[BuildEvent]
    report: BuildReport | None

    @computed_field  # type: ignore[prop-decorator]
    @property
    def pr_url(self) -> str | None:
        """The pull request the runner opened (`delivery: pull_request`), read from its
        `system` event: no column, so no migration (docs/BUILDS.md §7)."""
        for event in reversed(self.events):
            if event.kind == "system" and event.text.startswith(PR_PREFIX):
                return event.text.removeprefix(PR_PREFIX).strip() or None
        return None


class BuildPlanVersion(BaseModel):
    """One version of a build's plan (docs/BUILDS.md §7b)."""

    version: int
    plan: BuildPlan
    origin: Origin
    feedback: Annotated[str | None, Field(description="The replan feedback that produced it.")]
    based_on: Annotated[int | None, Field(description="The version it revised; null for v1.")]
    model: Annotated[str | None, Field(description="A skill draft: the model that ran.")]
    created_at: datetime
    current: Annotated[bool, Field(description="The build's current plan.")]


class PresetPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    key: str
    label: str
    description: str
    goal: str
    stack: str | None
    toolchains: list[str]
    stops: BuildStopsInput


class PreflightCheckPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    key: str
    ok: bool
    level: Literal["error", "warning"]
    message: str
    fix: str | None


class PreflightPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    ready: Annotated[bool, Field(description="No failing error: a build can start.")]
    checks: list[PreflightCheckPublic]


# --- context (docs/BUILDS.md §7) ----------------------------------------------------------


class ContextSection(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    key: str
    title: str
    markdown: str  # the section body, without its `## title`; "" when the shelf has nothing
    words: int


class SuggestedReference(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    kind: Literal["url", "shelf"]
    url: str | None
    document_id: uuid.UUID | None
    title: str
    source: Literal["code", "data", "paper", "cited", "shelf"]


class ContextPreview(BaseModel):
    sections: list[ContextSection]
    header: str
    suggested_references: list[SuggestedReference]


class ContextFile(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    path: str
    content: str
    words: int
    pending: Annotated[
        bool, Field(description="A snapshot fetched when the build starts, not yet fetched.")
    ] = False


class BuildContextView(BaseModel):
    files: list[ContextFile]
    kickoff: str
    agent_brief: str
    allowed_tools: list[str]
    command: list[str]
    model: str
    effort: str
    plan_input: dict[str, Any] | None
    source: Literal["workspace", "rendered"]
    survey_md: str | None = None  # §7c: the repository survey as the agent reads it


class ContextRender(_Strict):
    """A build not created yet, as the form has it; only `options` is required."""

    options: BuildOptionsInput = Field(default_factory=BuildOptionsInput)
    goal: Annotated[str, StringConstraints(max_length=4000)] | None = None
    preset: Annotated[str, StringConstraints(max_length=100)] | None = None
    stops: BuildStopsInput = Field(default_factory=BuildStopsInput)

"""Wire shapes for the server-side settings."""

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field

from app.models.build import BuildVisibility
from app.schemas.build_options import (
    CommitStyle,
    Delivery,
    EffortChoice,
    License,
    ModelChoice,
    PushPolicy,
    TestsPolicy,
)
from app.schemas.builds import MaxBudget, MaxCommits, MaxMinutes, Owner
from app.services.app_settings import AutoApprove


class AutoDeriveChoice(BaseModel):
    """A skill a document of a group can make on its own, and whether it does."""

    skill: str
    description: str
    enabled: bool


class AutoDerivePublic(BaseModel):
    book: list[AutoDeriveChoice]
    paper: list[AutoDeriveChoice]


AutoApproveField = Annotated[
    AutoApprove,
    Field(
        description="Approve a skill's new artifact on arrival: `off` (wait for a review), "
        "`passing` (only drafts every quality gate passed) or `all` (flagged ones too)."
    ),
]


class BuildAdvancedDefaults(BaseModel):
    """The defaults of a new build's `options.advanced` (docs/BUILDS.md §7)."""

    model_config = ConfigDict(from_attributes=True)

    model: ModelChoice
    effort: EffortChoice
    plan_model: ModelChoice
    commit_style: CommitStyle
    tests: TestsPolicy
    license: License
    delivery: Delivery
    push: PushPolicy


class BuildAdvancedDefaultsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    model: ModelChoice | None = None
    effort: EffortChoice | None = None
    plan_model: ModelChoice | None = None
    commit_style: CommitStyle | None = None
    tests: TestsPolicy | None = None
    license: License | None = None
    delivery: Delivery | None = None
    push: PushPolicy | None = None


class BuildsSettings(BaseModel):
    """What a new build starts from (docs/BUILDS.md §4); its preset and form override it."""

    model_config = ConfigDict(from_attributes=True)

    owner: Annotated[Owner | None, Field(description="GitHub org or user; null: the gh account.")]
    visibility: BuildVisibility
    claude_attribution: bool
    link_paper: bool
    max_minutes: MaxMinutes
    max_commits: MaxCommits
    max_budget_usd: MaxBudget | None
    advanced: BuildAdvancedDefaults


class SettingsPublic(BaseModel):
    auto_derive: AutoDerivePublic
    auto_approve: AutoApproveField
    builds: BuildsSettings


class AutoDeriveUpdate(BaseModel):
    book: Annotated[list[str] | None, Field(max_length=50)] = None
    paper: Annotated[list[str] | None, Field(max_length=50)] = None


class BuildsSettingsUpdate(BaseModel):
    """Only the fields sent change; `owner` or `max_budget_usd` sent as null clear them."""

    model_config = ConfigDict(extra="forbid")

    owner: Owner | None = None
    visibility: BuildVisibility | None = None
    claude_attribution: bool | None = None
    link_paper: bool | None = None
    max_minutes: MaxMinutes | None = None
    max_commits: MaxCommits | None = None
    max_budget_usd: MaxBudget | None = None
    advanced: BuildAdvancedDefaultsUpdate | None = None

    def changes(self) -> dict[str, object]:
        """The fields sent; a null is kept only where it means "none" (owner, budget).
        `advanced` carries only its non-null fields (merged key by key)."""
        sent = self.model_dump(exclude_unset=True, exclude={"advanced"})
        out = {k: v for k, v in sent.items() if v is not None or k in _NULLABLE}
        if self.advanced is not None:
            out["advanced"] = self.advanced.model_dump(exclude_none=True)
        return out


_NULLABLE = frozenset({"owner", "max_budget_usd"})


class SettingsUpdate(BaseModel):
    auto_derive: AutoDeriveUpdate | None = None
    auto_approve: AutoApproveField | None = None
    builds: BuildsSettingsUpdate | None = None

"""Wire shapes for the server-side settings."""

from typing import Annotated

from pydantic import BaseModel, Field

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


class SettingsPublic(BaseModel):
    auto_derive: AutoDerivePublic
    auto_approve: AutoApproveField


class AutoDeriveUpdate(BaseModel):
    book: Annotated[list[str] | None, Field(max_length=50)] = None
    paper: Annotated[list[str] | None, Field(max_length=50)] = None


class SettingsUpdate(BaseModel):
    auto_derive: AutoDeriveUpdate | None = None
    auto_approve: AutoApproveField | None = None

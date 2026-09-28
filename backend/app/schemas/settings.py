"""Wire shapes for the server-side settings."""

from typing import Annotated

from pydantic import BaseModel, Field


class AutoDeriveChoice(BaseModel):
    """A skill a document of a group can make on its own, and whether it does."""

    skill: str
    description: str
    enabled: bool


class AutoDerivePublic(BaseModel):
    book: list[AutoDeriveChoice]
    paper: list[AutoDeriveChoice]


class SettingsPublic(BaseModel):
    auto_derive: AutoDerivePublic


class AutoDeriveUpdate(BaseModel):
    book: Annotated[list[str] | None, Field(max_length=50)] = None
    paper: Annotated[list[str] | None, Field(max_length=50)] = None


class SettingsUpdate(BaseModel):
    auto_derive: AutoDeriveUpdate | None = None

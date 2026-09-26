"""Wire shapes for the skill catalogue and the interactive-mode inputs endpoint."""

import uuid
from typing import Any

from pydantic import BaseModel

from app.models.enums import ArtifactType, JobKind, Tier


class SkillGates(BaseModel):
    grounding_min: float
    compression: tuple[float, float] | None
    max_words: int | None
    coverage_min: float | None = None
    words_per_minute: tuple[float, float] | None = None


class SkillParam(BaseModel):
    """A run parameter: pick one of `choices` per job (`POST /jobs` `params`)."""

    choices: list[str | int]
    default: str | int
    description: str


class SkillPublic(BaseModel):
    name: str
    version: str
    description: str
    tier: Tier
    job_kind: JobKind | None
    artifact_type: ArtifactType | None
    scope: str
    selector: str
    document_selector: str | None
    document_tier: Tier | None
    vision: bool
    gates: SkillGates
    params: dict[str, SkillParam] = {}
    narrate: bool = False


class SkillInputs(BaseModel):
    """Exactly what the batch runner would send, and the hash an import must quote back."""

    skill: str
    skill_version: str
    document_id: uuid.UUID
    anchor: str | None
    input_hash: str
    inputs: dict[str, Any]

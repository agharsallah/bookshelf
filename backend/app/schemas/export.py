"""The JSON export (§16 Q5): the tree plus approved artifacts, in render-contract JSON."""

import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import ArtifactType, Origin
from app.schemas.document import DocumentPublic
from app.schemas.node import TreeNode


class ExportArtifact(BaseModel):
    """One approved artifact; `body` is exactly as stored (render-contract blocks)."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    type: ArtifactType
    anchor: str | None
    note_id: uuid.UUID | None
    version: int
    origin: Origin
    skill: str | None
    skill_version: str | None
    model: str | None
    citations: list[str]
    body: dict[str, Any]
    created_at: datetime


class DocumentExport(BaseModel):
    format: Literal["bookshelf.export"] = "bookshelf.export"
    version: Annotated[int, Field(description="Bumped when this shape changes.")] = 1
    document: DocumentPublic
    tree: list[TreeNode]
    artifacts: Annotated[
        list[ExportArtifact], Field(description="Latest approved version per scope and type.")
    ]

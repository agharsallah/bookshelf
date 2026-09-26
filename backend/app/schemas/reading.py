"""Wire shapes for reading progress."""

from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.node import Anchor


class PositionUpdate(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={
            "examples": [{"unit": "ch03", "anchor": "ch03/s02/p014", "progress": 0.42}]
        },
    )

    unit: Annotated[Anchor, Field(description="The chapter being read.")]
    anchor: Annotated[Anchor, Field(description="The block being read: where to pick up again.")]
    progress: Annotated[
        float,
        Field(
            ge=0,
            le=1,
            description="How far through the chapter, 0 to 1. Only ever raises the stored value.",
        ),
    ]


class ReadingPositionPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    unit: str
    anchor: str
    progress: Annotated[float, Field(description="Furthest point reached in the chapter, 0 to 1.")]
    updated_at: datetime

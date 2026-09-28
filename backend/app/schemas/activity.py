"""Wire shapes for attention reports (`POST /activity`)."""

from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import Surface

MAX_ENTRIES = 500

Place = Annotated[str, Field(max_length=200, pattern=r"^[A-Za-z0-9_./-]*$")]


class ActivityEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    at: Annotated[datetime, Field(description="When: any moment inside the minute counted.")]
    surface: Surface
    seconds: Annotated[int, Field(ge=1, le=60, description="Seconds of attention counted.")]
    document: Annotated[
        str | None, Field(min_length=1, max_length=200, description="Document uuid or slug.")
    ] = None
    unit: Annotated[Place, Field(description="The chapter anchor.")] = ""
    anchor: Annotated[Place, Field(description="The block being read.")] = ""
    detail: Annotated[
        str,
        Field(max_length=40, pattern=r"^[a-z0-9_-]*$", description="What the surface showed."),
    ] = ""


class ActivityBatch(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={
            "examples": [
                {
                    "entries": [
                        {
                            "at": "2026-09-28T09:14:00Z",
                            "surface": "read",
                            "seconds": 45,
                            "document": "meadows-systems",
                            "unit": "ch03",
                            "anchor": "ch03/s02/p014",
                        }
                    ]
                }
            ]
        },
    )

    entries: Annotated[list[ActivityEntry], Field(min_length=1, max_length=MAX_ENTRIES)]


class ActivityRecorded(BaseModel):
    recorded: Annotated[int, Field(description="Minute rows the batch added to.")]

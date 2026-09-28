"""Wire shapes for recalls and predictions, and the grades recalls get."""

import uuid
from datetime import datetime
from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import RecallKind
from app.schemas.job import JobPublic
from app.schemas.node import Anchor
from app.services.recalls import RecallView


class RecallCreate(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={
            "examples": [
                {"unit": "ch03", "kind": "recall", "raw": "Busy teams wait more, and…"},
                {"unit": "ch04", "kind": "prediction", "raw": "It will argue for WIP limits."},
            ]
        },
    )

    unit: Annotated[Anchor, Field(description="The chapter recalled or predicted.")]
    kind: RecallKind = RecallKind.RECALL
    raw: Annotated[
        str, Field(min_length=1, max_length=20000, description="Your words. Never edited.")
    ]


class GradePublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    ideas: Annotated[
        list[dict[str, Any]],
        Field(
            description="Each key idea `{id, tier, text, why, cites, status, feedback, cue?}`, "
            "status `recalled` | `partial` | `missed`."
        ),
    ]
    question: Annotated[
        dict[str, Any] | None,
        Field(description='`{idea, text, cites}`: one "why is this true?" about a recalled idea.'),
    ]
    comparison: Annotated[
        dict[str, Any] | None,
        Field(description="`{predicted, argues, ideas, cites}`: your prediction and the thesis."),
    ]
    prediction_id: uuid.UUID | None
    origin: str
    model: str | None
    created_at: datetime


class RecallPublic(BaseModel):
    id: uuid.UUID
    unit: str
    kind: RecallKind
    raw: str
    created_at: datetime
    grade: GradePublic | None

    @classmethod
    def from_view(cls, view: RecallView) -> "RecallPublic":
        r = view.recall
        grade = GradePublic.model_validate(view.grade) if view.grade is not None else None
        return cls(
            id=r.id, unit=r.unit, kind=r.kind, raw=r.raw, created_at=r.created_at, grade=grade
        )


class RecallCreated(RecallPublic):
    job: Annotated[JobPublic | None, Field(description="The grading job; null for a prediction.")]

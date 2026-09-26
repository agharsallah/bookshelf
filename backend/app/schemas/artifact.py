"""Wire shapes for artifacts (§13): list/filter, versions, human writes, review, import."""

import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import ArtifactType, Origin, Review, RunMode, Tier

CalloutTone = Literal[
    "important", "remember", "antipattern", "insight", "caution", "contrast", "question"
]
AnchorField = Annotated[str, Field(max_length=200, pattern=r"^[a-z]+[0-9]+(/[a-z]+[0-9]+)*$")]


class ArtifactPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    document_id: uuid.UUID
    anchor: str | None
    note_id: uuid.UUID | None
    variant: Annotated[
        str | None,
        Field(description="The episode a parameterised run made (`15m-conversation-en`)."),
    ] = None
    type: ArtifactType
    version: int
    origin: Origin
    skill: str | None
    skill_version: str | None
    model: str | None
    run_mode: RunMode | None
    tier: Tier | None
    input_hash: str
    body: dict[str, Any]
    citations: list[str]
    gates: Annotated[
        dict[str, Any],
        Field(description="Gate record: grounding, compression, words, flags, schema_retry."),
    ]
    review: Review
    reviewed_at: datetime | None
    created_at: datetime


class ArtifactListItem(ArtifactPublic):
    matched_blocks: Annotated[
        list[dict[str, Any]] | None,
        Field(description="With `?tone=`: the callout blocks of that tone inside `body`."),
    ] = None
    superseded: Annotated[
        bool,
        Field(description="A newer non-rejected version of this scope exists (e.g. an edit)."),
    ] = False


class ArtifactCreate(BaseModel):
    """A human-authored artifact (D15): schema + anchor validity only, approved on arrival."""

    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={
            "examples": [
                {
                    "document_id": "…",
                    "type": "chapter_distillation",
                    "anchor": "ch03",
                    "body": {
                        "blocks": [
                            {
                                "type": "paragraph",
                                "spans": [
                                    {"text": "Stocks change through flows.", "cites": ["ch03/p002"]}
                                ],
                            }
                        ]
                    },
                }
            ]
        },
    )

    document_id: uuid.UUID
    type: ArtifactType
    anchor: AnchorField | None = None
    note_id: uuid.UUID | None = None
    body: dict[str, Any]


class ReviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: Annotated[
        Literal["approve", "reject", "edit", "reopen"],
        Field(description="`reopen` returns an approved or rejected artifact to `draft`."),
    ]
    body: Annotated[
        dict[str, Any] | None, Field(description="Required for `edit`: the corrected body.")
    ] = None


class ArtifactImport(BaseModel):
    """An interactive-mode result from `skills/.outbox/` (see skills/README.md)."""

    model_config = ConfigDict(extra="forbid")

    skill: Annotated[str, Field(max_length=100)]
    document: Annotated[str, Field(max_length=200, description="Document slug or id.")]
    anchor: AnchorField | None = None
    input_hash: Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
    output: dict[str, Any]
    note_id: uuid.UUID | None = None
    params: Annotated[
        dict[str, str | int] | None,
        Field(description="The run parameters the inputs were fetched with, if any."),
    ] = None
    model: Annotated[str | None, Field(max_length=100)] = None
    force: Annotated[
        bool, Field(description="Supersede an existing artifact for the same input.")
    ] = False

"""Wire shapes of the claim tracker (docs/PAPERS.md P4, §5, §7): a paper's claims with how
the rest of the shelf bears on them, one claim's relations, and the reader's margin marks.

Relation counts read from the claim's side, over **accepted** claim ↔ claim edges:
`supported_by` / `extended_by` count other claims that support / extend this one,
`supports` / `extends` the claims this one supports / extends, `contradicted_by` every
`contradicts` edge either way (a contradiction is mutual). `proposed` counts the relations
still waiting for a human, whatever their kind.
"""

import uuid
from typing import Annotated, Literal

from pydantic import BaseModel, Field

from app.models.enums import EdgeStatus, Relation
from app.schemas.graph import DocumentRef, Passage
from app.schemas.papers import ClaimPublic


class ClaimRelationCounts(BaseModel):
    supported_by: int = 0
    contradicted_by: int = 0
    extended_by: int = 0
    supports: int = 0
    extends: int = 0
    proposed: Annotated[int, Field(description="Relations awaiting review (any kind).")] = 0


class ClaimWithRelations(ClaimPublic):
    relations: ClaimRelationCounts


class ClaimUnitGroup(BaseModel):
    unit: Annotated[str | None, Field(description="Unit anchor; null: claims of the abstract.")]
    heading: str | None
    role: str | None
    claims: list[ClaimWithRelations]


class PaperClaims(BaseModel):
    document_id: uuid.UUID
    artifact_id: Annotated[
        uuid.UUID | None, Field(description="The approved claim_set the rows come from.")
    ]
    total: int
    units: Annotated[list[ClaimUnitGroup], Field(description="In reading order.")]


class ClaimRelation(BaseModel):
    """One claim ↔ claim edge, read from the claim asked about."""

    edge_id: uuid.UUID
    relation: Relation
    direction: Annotated[
        Literal["out", "in"], Field(description="out: this claim <relation> the other.")
    ]
    status: EdgeStatus
    weight: float
    confidence: str | None
    rationale: str | None
    other: ClaimPublic
    other_document: DocumentRef | None
    evidence: Annotated[list[Passage], Field(description="Cited passages of both papers.")]


class ClaimRelations(BaseModel):
    claim: ClaimPublic
    document: DocumentRef | None
    relations: Annotated[
        list[ClaimRelation], Field(description="Accepted, then proposed; rejected are left out.")
    ]


class MarkedClaim(BaseModel):
    id: uuid.UUID
    key: str
    strength: str


class ClaimMark(BaseModel):
    """What the reader's margin shows next to one passage."""

    anchor: str
    claims: list[MarkedClaim]
    supported_by: int
    contradicted_by: int
    extended_by: int


class ClaimMarks(BaseModel):
    document_id: uuid.UUID
    unit: str | None
    marks: Annotated[list[ClaimMark], Field(description="In reading order of the anchors.")]


class RelateQueued(BaseModel):
    jobs: Annotated[list[uuid.UUID], Field(description="relate_claims jobs queued (per paper).")]

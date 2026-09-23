"""Wire shapes for the idea graph (§11, §13): concepts, edges, evidence, neighborhoods.

Every endpoint id is one string, `<kind>:<id>` — `concept:<uuid>`, `document:<uuid>`,
`artifact:<uuid>`, `node:<document_id>#<anchor>` — and is accepted back as `?node=`.
Evidence entries are qualified anchors, `<document_id>#<anchor>`.
"""

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import ConceptKind, EdgeStatus, EntityKind, Origin, Relation

GraphRef = Annotated[
    str,
    Field(
        min_length=3,
        max_length=300,
        description="`concept:<id>`, `node:<document_id>#<anchor>`, `document:<id>`, "
        "`artifact:<id>`, or a bare id.",
        examples=["concept:3f1c2b8e-2c4a-4d8e-9a53-0d1f1e0b7c11"],
    ),
]
EvidenceRef = Annotated[
    str,
    Field(
        max_length=300,
        pattern=r"^[0-9a-fA-F-]{36}#[a-z]+[0-9]+(/[a-z]+[0-9]+)*$",
        description="Qualified anchor `<document_id>#<anchor>`.",
    ),
]
Name = Annotated[str, Field(min_length=1, max_length=200)]


class DocumentRef(BaseModel):
    id: uuid.UUID
    slug: str
    title: str


class Passage(BaseModel):
    """One evidence passage, resolvable in the reader as `{document.slug, anchor}`."""

    ref: str
    document: DocumentRef | None
    anchor: str
    kind: str | None
    heading: Annotated[str | None, Field(description="Nearest heading at or above the anchor.")]
    snippet: str | None
    exists: Annotated[bool, Field(description="False when the anchor vanished on a re-parse.")]


class ConceptSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    canonical: str
    aliases: list[str]
    kind: ConceptKind
    blurb: str | None
    merged_into: uuid.UUID | None
    origin: Annotated[Origin, Field(description="`human` once a person created or edited it.")]
    edge_count: Annotated[
        int,
        Field(description="Accepted edges, with the concepts merged into it folded in (lists)."),
    ] = 0


class ConceptPublic(ConceptSummary):
    blurb_cites: list[str]
    created_at: datetime


class ConceptCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    canonical: Name
    kind: ConceptKind = ConceptKind.CONCEPT
    aliases: Annotated[list[Name], Field(max_length=30)] = []
    blurb: Annotated[str | None, Field(max_length=2000)] = None
    blurb_cites: Annotated[list[EvidenceRef], Field(max_length=20)] = []


class ConceptUpdate(BaseModel):
    """Omitted fields stay; `blurb: null` clears the blurb and its cites."""

    model_config = ConfigDict(extra="forbid")

    canonical: Name | None = None
    kind: ConceptKind | None = None
    aliases: Annotated[list[Name] | None, Field(max_length=30)] = None
    blurb: Annotated[str | None, Field(max_length=2000)] = None
    blurb_cites: Annotated[list[EvidenceRef] | None, Field(max_length=20)] = None


class MergeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    into: Annotated[uuid.UUID, Field(description="The survivor; the path concept is merged.")]


class GraphNode(BaseModel):
    id: GraphRef
    kind: EntityKind
    label: str
    sublabel: str | None = None
    document: DocumentRef | None = None
    anchor: str | None = None
    blurb: str | None = None
    depth: Annotated[int, Field(ge=0, le=2)] = 0
    weight: Annotated[float, Field(description="Best edge score into the previous ring.")] = 0
    more: Annotated[int, Field(ge=0, description="Neighbors left out of this response.")] = 0


class GraphEdge(BaseModel):
    id: uuid.UUID
    src: str
    dst: str
    relation: Relation
    weight: float
    evidence_count: int
    status: EdgeStatus
    origin: str
    edge_ids: Annotated[
        list[uuid.UUID],
        Field(description="Underlying edges; several when a document focus folds passages."),
    ]


class Neighborhood(BaseModel):
    focus: GraphRef
    depth: int
    nodes: list[GraphNode]
    edges: Annotated[list[GraphEdge], Field(description="Ranked by weight x evidence count.")]
    truncated: Annotated[bool, Field(description="The node cap (150) cut the neighborhood.")]


class ConceptEdge(BaseModel):
    id: uuid.UUID
    relation: Relation
    direction: Literal["out", "in"]
    other: GraphNode
    weight: float
    status: EdgeStatus
    origin: str
    evidence: list[Passage]


class RelationGroup(BaseModel):
    relation: Relation
    edges: list[ConceptEdge]


class ConceptDetail(BaseModel):
    concept: ConceptPublic
    blurb_passages: list[Passage]
    relations: Annotated[
        list[RelationGroup], Field(description="Accepted and proposed edges, strongest first.")
    ]


class EdgeCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    src: GraphRef
    dst: GraphRef
    relation: Relation
    weight: Annotated[float, Field(ge=0, le=1)] = 1.0
    evidence: Annotated[list[EvidenceRef], Field(min_length=1, max_length=20)]


class EdgeUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: EdgeStatus


class EdgeDetail(BaseModel):
    id: uuid.UUID
    src: GraphNode
    dst: GraphNode
    relation: Relation
    weight: float
    status: EdgeStatus
    origin: str
    evidence: list[Passage]
    created_at: datetime


class MergeProposal(BaseModel):
    """A proposed `same_as`: merge one side into the other with `POST /concepts/{id}/merge`."""

    edge_id: uuid.UUID
    a: ConceptSummary
    b: ConceptSummary
    similarity: Annotated[float | None, Field(description="Embedding cosine (dedup only).")]
    confidence: str | None
    rationale: Annotated[str | None, Field(description="The model's reason (dedup only).")]
    suggested_survivor: uuid.UUID | None
    origin: str
    evidence: list[Passage]
    created_at: datetime

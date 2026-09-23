"""Wire shapes for `POST /search`, `POST /search/answer` (SSE) and `GET /search/suggest`.

Scores are comparable within one response only: vector hits carry the cross-encoder's
relevance score, lexical hits `ts_rank_cd`, addressed hits a fixed 1.0.
"""

import uuid
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.models.enums import ArtifactType

SearchMode = Literal["auto", "addressed", "discovery", "synthesis", "lexical"]
Intent = Literal["addressed", "discovery", "synthesis", "lexical"]
Query = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
Tag = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]


class SearchFilters(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document_ids: Annotated[list[uuid.UUID] | None, Field(max_length=100)] = None
    tags: Annotated[list[Tag] | None, Field(max_length=50)] = None
    types: Annotated[
        list[ArtifactType] | None,
        Field(max_length=20, description="Artifact types of distillation hits."),
    ] = None


class SearchRequest(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={
            "examples": [
                {"query": "what do I know about feedback loops?"},
                {"query": "summarize chapter 3 of Meadows", "mode": "auto"},
                {"query": '"stock and flow"', "filters": {"tags": ["systems"]}, "limit": 5},
            ]
        },
    )

    query: Query
    mode: SearchMode = "auto"
    filters: SearchFilters = Field(default_factory=SearchFilters)
    limit: Annotated[int, Field(ge=1, le=20, description="Maximum number of documents.")] = 5


class DocumentRef(BaseModel):
    id: uuid.UUID
    slug: str
    title: str
    authors: list[str]


class ResolvedAddress(BaseModel):
    """Where an addressed query landed. `anchor` is null for the whole document."""

    document: DocumentRef
    anchor: str | None


class SearchHit(BaseModel):
    kind: Literal["distillation", "block"]
    anchor: str | None = Field(description="Block address; null for document-scope artifacts.")
    type: ArtifactType | None = Field(default=None, description="Distillation hits only.")
    artifact_id: uuid.UUID | None = None
    heading: str | None = Field(default=None, description="The enclosing chapter/section.")
    score: float
    snippet: str
    highlights: list[tuple[int, int]] | None = Field(
        default=None, description="Lexical hits: [start, end) character ranges in `snippet`."
    )
    blocks: list[dict[str, Any]] | None = Field(
        default=None, description="Addressed hits: the artifact body as render blocks."
    )


class SearchGroup(BaseModel):
    document: DocumentRef
    hits: list[SearchHit]


class ConceptEnd(BaseModel):
    id: uuid.UUID
    canonical: str


RelationName = Literal["contradicts", "supports", "extends"]
IndexState = Literal["ready", "empty", "unavailable"]


class ConceptRelation(BaseModel):
    """An accepted edge between two concepts, evidenced in the result documents."""

    relation: RelationName
    src: ConceptEnd
    dst: ConceptEnd
    weight: float
    evidence: list[str] = Field(description="`<slug>:<anchor>` passages in the result documents.")


class SearchResponse(BaseModel):
    intent: Intent
    resolved: ResolvedAddress | None = None
    groups: list[SearchGroup]
    relations: list[ConceptRelation] = Field(
        default_factory=list,
        description="Synthesis only: contradicts / supports / extends edges between concepts "
        "evidenced in the result documents, contradictions first.",
    )
    index_state: IndexState | None = Field(
        default=None,
        description="Vector intents only: `empty` (nothing indexed yet) or `unavailable` "
        "(Qdrant unreachable) explain empty `groups`; addressed and lexical never need it.",
    )
    took_ms: int


# --- Answer stream (SSE) ----------------------------------------------------------------


class StatusEvent(BaseModel):
    """`event: status` — progress while the answer is being prepared."""

    stage: Literal["routing", "searching", "writing"]
    message: str


class CiteSource(BaseModel):
    """What one qualified cite (`<slug>:<anchor>`) points at."""

    document: DocumentRef
    anchor: str


class AnswerEvent(BaseModel):
    """`event: answer` — render blocks whose cites are `<slug>:<anchor>` keys of `sources`."""

    blocks: list[dict[str, Any]]
    sources: dict[str, CiteSource]
    dropped_cites: list[str] = Field(
        description="Cites the model produced that were not in the evidence set (removed)."
    )
    model: str | None


class ErrorEvent(BaseModel):
    """`event: error` — the stream ends after this."""

    code: str
    message: str


# --- Suggest ----------------------------------------------------------------------------


class SuggestItem(BaseModel):
    """Documents and chapters carry `document` (id, slug) and chapters their `anchor`;
    concepts carry `id` (for `/concepts/{id}`), documents their id too."""

    kind: Literal["document", "chapter", "concept"]
    label: str
    id: uuid.UUID | None = None
    document: DocumentRef | None = None
    anchor: str | None = None


class SuggestResponse(BaseModel):
    items: list[SuggestItem]

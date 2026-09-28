"""Wire shapes for the paper tables (docs/PAPERS.md §2, §7).

`*Public` models read the ORM rows (`from_attributes`); `*Create` / `*Update` models are
request bodies (`extra="forbid"`). Limits mirror the migration's check constraints, so a
bad value is a `422` here rather than a database error.
"""

import uuid
from datetime import datetime
from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.models.enums import (
    CandidateSource,
    CandidateStatus,
    CitationIntent,
    ClaimKind,
    ClaimStrength,
    PaperMetaSource,
    PaperVerdict,
    Review,
)

Stars = Annotated[int, Field(ge=1, le=5)]
PassNumber = Annotated[int, Field(ge=1, le=3)]
Year = Annotated[int, Field(ge=-3000, le=3000)]
Note = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=20000)]
Doi = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]
ShortId = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]
Venue = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
Url = Annotated[str, StringConstraints(max_length=2048, pattern=r"^https?://[^\s]+$")]
Field_ = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


# --- paper_meta ------------------------------------------------------------------


class PaperMetaPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    document_id: uuid.UUID
    doi: str | None
    arxiv_id: str | None
    openalex_id: str | None
    venue: str | None
    year: int | None
    abstract: str | None
    fields: list[str]
    code_urls: list[str]
    data_urls: list[str]
    cited_by_count: int | None
    reference_count: int | None
    source: PaperMetaSource
    enriched_at: datetime | None
    updated_at: datetime


class PaperMetaUpdate(BaseModel):
    """Human fix-up (`PATCH /papers/{ref}/meta`, sets `source = human`). Omitted fields are
    left alone; an explicit `null` clears a nullable one."""

    model_config = ConfigDict(extra="forbid")

    doi: Doi | None = None
    arxiv_id: ShortId | None = None
    openalex_id: ShortId | None = None
    venue: Venue | None = None
    year: Year | None = None
    abstract: Annotated[str | None, Field(default=None, min_length=1, max_length=20000)]
    fields: Annotated[list[Field_] | None, Field(default=None, max_length=100)]
    code_urls: Annotated[list[Url] | None, Field(default=None, max_length=50)]
    data_urls: Annotated[list[Url] | None, Field(default=None, max_length=50)]


# --- paper_references --------------------------------------------------------------


class PaperReferencePublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    document_id: uuid.UUID
    ordinal: int
    anchor: str | None
    raw: str
    title: str | None
    authors: list[str]
    year: int | None
    venue: str | None
    doi: str | None
    arxiv_id: str | None
    openalex_id: str | None
    target_document_id: Annotated[
        uuid.UUID | None, Field(description="The shelf document this entry is, if any.")
    ]
    cited_at: Annotated[list[str], Field(description="Anchors of the in-text citations.")]
    intent: CitationIntent | None
    intent_cites: list[str]


# --- claims --------------------------------------------------------------------------


class ClaimPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    document_id: uuid.UUID
    artifact_id: uuid.UUID
    key: str
    text: str
    kind: ClaimKind
    strength: ClaimStrength
    evidence: Annotated[list[str], Field(description="Anchors the claim rests on.")]
    unit: str | None


# --- paper_ratings (yours, append-only) ------------------------------------------------


class PaperRatingCreate(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={"examples": [{"stars": 4, "verdict": "useful", "note": "Solid."}]},
    )

    stars: Stars
    verdict: PaperVerdict | None = None
    note: Annotated[Note | None, Field(default=None, description="Your words. Never edited.")]


class PaperRatingPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    document_id: uuid.UUID
    stars: int
    verdict: PaperVerdict | None
    note: str | None
    created_at: datetime


# --- paper_passes ----------------------------------------------------------------------


class PaperPassUpdate(BaseModel):
    """`PUT /papers/{ref}/passes/{pass}` body."""

    model_config = ConfigDict(extra="forbid")

    note: Note | None = None


class PaperPassPublic(BaseModel):
    """The ORM attribute is `pass_` (a keyword); the wire name is `pass`."""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    document_id: uuid.UUID
    pass_: Annotated[int, Field(alias="pass")]
    completed_at: datetime
    note: str | None


# --- reading_candidates ----------------------------------------------------------------


class CandidateSourceRef(BaseModel):
    """One entry of `reading_candidates.sources`: how the candidate was found."""

    model_config = ConfigDict(extra="forbid")

    kind: CandidateSource
    document_id: uuid.UUID | None = None


class ReadingCandidatePublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    openalex_id: str | None
    doi: str | None
    arxiv_id: str | None
    title: str
    authors: list[str]
    year: int | None
    venue: str | None
    abstract: str | None
    pdf_url: str | None
    cited_by_count: int | None
    sources: list[CandidateSourceRef]
    score: float
    score_parts: Annotated[dict[str, float], Field(description="Each term of `score`.")]
    reason: str | None
    reason_cites: Annotated[list[str], Field(description="`<document_id>#<anchor>` each.")]
    status: CandidateStatus
    document_id: Annotated[uuid.UUID | None, Field(description="Set once it is on the shelf.")]
    created_at: datetime
    updated_at: datetime


class CandidateUpdate(BaseModel):
    """`PATCH /papers/candidates/{id}`: queue or dismiss (`ingested` is set by ingest)."""

    model_config = ConfigDict(extra="forbid")

    status: CandidateStatus


# --- paper_sets and paper_syntheses ------------------------------------------------------


class PaperSetCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
    document_ids: Annotated[list[uuid.UUID], Field(min_length=1, max_length=100)]


class PaperSetPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    document_ids: list[uuid.UUID]
    created_at: datetime


class PaperSynthesisPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    set_id: uuid.UUID
    version: int
    body: dict[str, Any]
    citations: Annotated[list[str], Field(description="`<slug>:<anchor>` across the set.")]
    origin: str
    model: str | None
    input_hash: str
    review: Review
    created_at: datetime

"""Wire shapes for the paper shelf (`/papers`, `/papers/{ref}`, docs/PAPERS.md §7).

A paper row joins its document, `paper_meta`, your latest rating, the highest pass you
completed, which paper artifacts exist, and a few counts. Row-level shapes of the paper
tables themselves (`PaperMetaPublic`, `PaperRatingPublic`, …) live in `schemas/papers.py`.
"""

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Annotated, Self

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import ArtifactType, CandidateStatus, DocumentStatus, PaperMetaSource, Review
from app.schemas.papers import (
    PaperMetaPublic,
    PaperPassPublic,
    PaperRatingPublic,
    PaperReferencePublic,
)
from app.services.paper_records import ReferenceRow
from app.services.papers import PaperFacts


class PaperSort(StrEnum):
    RECENT = "recent"  # added to the shelf, newest first (default)
    TITLE = "title"
    YEAR = "year"  # newest first, unknown last
    STARS = "stars"  # your latest stars, best first, unrated last
    CITED_BY = "cited_by"  # OpenAlex cited_by_count, most first, unknown last


class PaperArtifactState(BaseModel):
    """The preferred artifact of one paper type (and variant): latest approved, else latest
    draft or needs_review. Rejected ones are not listed."""

    model_config = ConfigDict(from_attributes=True)

    type: ArtifactType
    variant: Annotated[str | None, Field(description="e.g. the explainer level.")]
    artifact_id: uuid.UUID
    review: Review
    created_at: datetime


class PaperCounts(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    references: Annotated[int, Field(description="Parsed bibliography entries.")]
    references_on_shelf: Annotated[int, Field(description="Entries matched to a shelf doc.")]
    claims: Annotated[int, Field(description="Materialized claims of the approved claim_set.")]


class PaperSummary(BaseModel):
    """One paper of the shelf. `year` is `paper_meta.year`, else the document's."""

    id: uuid.UUID
    slug: str
    title: str
    authors: list[str]
    year: int | None
    status: DocumentStatus
    venue: str | None
    doi: str | None
    arxiv_id: str | None
    openalex_id: str | None
    cited_by_count: int | None
    meta_source: Annotated[PaperMetaSource | None, Field(description="None: no paper_meta yet.")]
    rating: Annotated[PaperRatingPublic | None, Field(description="Your latest rating.")]
    highest_pass: Annotated[int | None, Field(description="1-3; None before the first pass.")]
    artifacts: list[PaperArtifactState]
    counts: PaperCounts
    created_at: datetime

    @classmethod
    def fields_from(cls, facts: PaperFacts) -> dict[str, object]:
        document, meta = facts.document, facts.meta
        return {
            "id": document.id,
            "slug": document.slug,
            "title": document.title,
            "authors": document.authors,
            "year": meta.year if meta is not None and meta.year is not None else document.year,
            "status": document.status,
            "venue": meta.venue if meta else None,
            "doi": meta.doi if meta else None,
            "arxiv_id": meta.arxiv_id if meta else None,
            "openalex_id": meta.openalex_id if meta else None,
            "cited_by_count": meta.cited_by_count if meta else None,
            "meta_source": meta.source if meta else None,
            "rating": (
                PaperRatingPublic.model_validate(facts.rating) if facts.rating is not None else None
            ),
            "highest_pass": max((p.pass_ for p in facts.passes), default=None),
            "artifacts": [PaperArtifactState.model_validate(a) for a in facts.artifacts],
            "counts": PaperCounts.model_validate(facts.counts),
            "created_at": document.created_at,
        }

    @classmethod
    def build(cls, facts: PaperFacts) -> Self:
        return cls.model_validate(cls.fields_from(facts))


class PaperDetail(PaperSummary):
    """A paper with its full `paper_meta` (abstract, fields, code and data URLs) and passes."""

    meta: PaperMetaPublic | None
    passes: Annotated[list[PaperPassPublic], Field(description="Completed passes, 1 first.")]

    @classmethod
    def build(cls, facts: PaperFacts) -> Self:
        return cls.model_validate(
            cls.fields_from(facts)
            | {
                "meta": PaperMetaPublic.model_validate(facts.meta) if facts.meta else None,
                "passes": [PaperPassPublic.model_validate(p) for p in facts.passes],
            }
        )


class FacetCount(BaseModel):
    value: str | int
    count: int


class PaperFacets(BaseModel):
    """Counts over the whole paper shelf (not the current filter), for the filter bar."""

    venues: Annotated[list[FacetCount], Field(description="Most papers first.")]
    years: Annotated[list[FacetCount], Field(description="Newest first.")]


class PaperPage(BaseModel):
    items: list[PaperSummary]
    total: Annotated[int, Field(ge=0, description="Total matching papers.")]
    limit: int
    offset: int
    facets: PaperFacets


class ShelfMatch(BaseModel):
    """The shelf document a bibliography entry is."""

    id: uuid.UUID
    slug: str
    title: str


class CandidateMatch(BaseModel):
    """The reading candidate a bibliography entry is (by OpenAlex id, DOI or arXiv id)."""

    id: uuid.UUID
    status: CandidateStatus
    score: float


class PaperReferenceRow(PaperReferencePublic):
    target: ShelfMatch | None
    candidate: CandidateMatch | None

    @classmethod
    def build(cls, row: ReferenceRow) -> Self:
        target = row.target
        candidate = row.candidate
        return cls.model_validate(
            PaperReferencePublic.model_validate(row.reference).model_dump()
            | {
                "target": (
                    ShelfMatch(id=target.id, slug=target.slug, title=target.title)
                    if target is not None
                    else None
                ),
                "candidate": (
                    CandidateMatch(id=candidate.id, status=candidate.status, score=candidate.score)
                    if candidate is not None
                    else None
                ),
            }
        )

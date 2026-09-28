"""Papers (docs/PAPERS.md §2): a paper is a document with `genre = 'paper'` (P1); these
tables hold what only papers have.

    paper_meta          1 per paper: identifiers, venue, abstract, OpenAlex counts
    paper_references    the bibliography, matched to the shelf, tagged with intent (P5)
    claims              DERIVED: materialized from the approved claim_set artifact (P4)
    paper_ratings       HUMAN: your verdict, append-only by trigger (P8, D11)
    paper_passes        HUMAN: three-pass reading progress
    reading_candidates  what to read next, scored in Python (P6)
    paper_sets          a user-chosen group of papers
    paper_syntheses     a literature review over a set (cross-document)
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Column, SmallInteger
from sqlmodel import Field, SQLModel

from app.models._columns import enum_type, jsonb, text_array, timestamptz, utcnow, uuid_array
from app.models.enums import (
    CandidateStatus,
    CitationIntent,
    ClaimKind,
    ClaimStrength,
    PaperMetaSource,
    PaperVerdict,
    Review,
)


class PaperMeta(SQLModel, table=True):
    __tablename__ = "paper_meta"

    document_id: uuid.UUID = Field(foreign_key="documents.id", ondelete="CASCADE", primary_key=True)
    doi: str | None = None
    arxiv_id: str | None = None
    openalex_id: str | None = None
    venue: str | None = None
    year: int | None = None
    abstract: str | None = None
    fields: list[str] = Field(default_factory=list, sa_column=text_array())
    code_urls: list[str] = Field(default_factory=list, sa_column=text_array())
    data_urls: list[str] = Field(default_factory=list, sa_column=text_array())
    cited_by_count: int | None = None
    reference_count: int | None = None
    source: PaperMetaSource = Field(
        default=PaperMetaSource.PARSED, sa_type=enum_type(PaperMetaSource)
    )
    enriched_at: datetime | None = Field(default=None, sa_column=timestamptz(nullable=True))
    updated_at: datetime = Field(default_factory=utcnow, sa_column=timestamptz())


class PaperReference(SQLModel, table=True):
    """One bibliography entry. `ordinal` is the `[n]` marker, or the list position."""

    __tablename__ = "paper_references"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    document_id: uuid.UUID = Field(foreign_key="documents.id", ondelete="CASCADE")
    ordinal: int
    anchor: str | None = None  # the reference block
    raw: str
    title: str | None = None
    authors: list[str] = Field(default_factory=list, sa_column=text_array())
    year: int | None = None
    venue: str | None = None
    doi: str | None = None
    arxiv_id: str | None = None
    openalex_id: str | None = None
    target_document_id: uuid.UUID | None = Field(
        default=None, foreign_key="documents.id", ondelete="SET NULL"
    )
    cited_at: list[str] = Field(default_factory=list, sa_column=text_array())  # in-text anchors
    intent: CitationIntent | None = Field(default=None, sa_type=enum_type(CitationIntent))
    intent_cites: list[str] = Field(default_factory=list, sa_column=text_array())
    created_at: datetime = Field(default_factory=utcnow, sa_column=timestamptz())


class Claim(SQLModel, table=True):
    """A claim of the approved claim_set. Rebuilt from the artifact, never edited (D1)."""

    __tablename__ = "claims"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    document_id: uuid.UUID = Field(foreign_key="documents.id", ondelete="CASCADE")
    artifact_id: uuid.UUID = Field(foreign_key="artifacts.id", ondelete="CASCADE")
    key: str  # 'C3', stable within one claim_set
    text: str
    kind: ClaimKind = Field(sa_type=enum_type(ClaimKind))
    strength: ClaimStrength = Field(sa_type=enum_type(ClaimStrength))
    evidence: list[str] = Field(sa_column=text_array())  # anchors, at least one
    unit: str | None = None  # the section it belongs to
    created_at: datetime = Field(default_factory=utcnow, sa_column=timestamptz())


class PaperRating(SQLModel, table=True):
    """Your verdict on a paper. Append-only (a trigger refuses updates); the latest wins."""

    __tablename__ = "paper_ratings"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    document_id: uuid.UUID = Field(foreign_key="documents.id", ondelete="CASCADE")
    stars: int
    verdict: PaperVerdict | None = Field(default=None, sa_type=enum_type(PaperVerdict))
    note: str | None = None
    created_at: datetime = Field(default_factory=utcnow, sa_column=timestamptz())


class PaperPass(SQLModel, table=True):
    """One completed reading pass (1-3). The column is `pass`, a Python keyword."""

    __tablename__ = "paper_passes"

    document_id: uuid.UUID = Field(foreign_key="documents.id", ondelete="CASCADE", primary_key=True)
    pass_: int = Field(sa_column=Column("pass", SmallInteger, primary_key=True))
    completed_at: datetime = Field(default_factory=utcnow, sa_column=timestamptz())
    note: str | None = None


class ReadingCandidate(SQLModel, table=True):
    """A paper to read next, on the shelf or off it. `score_parts` keeps every term of
    `score` so the UI can explain it; `reason` comes from recommend-next."""

    __tablename__ = "reading_candidates"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    openalex_id: str | None = None
    doi: str | None = None
    arxiv_id: str | None = None
    title: str
    authors: list[str] = Field(default_factory=list, sa_column=text_array())
    year: int | None = None
    venue: str | None = None
    abstract: str | None = None
    pdf_url: str | None = None
    cited_by_count: int | None = None
    # [{kind: CandidateSource, document_id}]
    sources: list[dict[str, Any]] = Field(
        default_factory=list, sa_column=jsonb(server_default="[]")
    )
    score: float = 0.0
    score_parts: dict[str, float] = Field(default_factory=dict, sa_column=jsonb())
    reason: str | None = None
    reason_cites: list[str] = Field(default_factory=list, sa_column=text_array())
    status: CandidateStatus = Field(
        default=CandidateStatus.SUGGESTED, sa_type=enum_type(CandidateStatus)
    )
    document_id: uuid.UUID | None = Field(
        default=None, foreign_key="documents.id", ondelete="SET NULL"
    )
    created_at: datetime = Field(default_factory=utcnow, sa_column=timestamptz())
    updated_at: datetime = Field(default_factory=utcnow, sa_column=timestamptz())


class PaperSet(SQLModel, table=True):
    __tablename__ = "paper_sets"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    name: str
    document_ids: list[uuid.UUID] = Field(sa_column=uuid_array())
    created_at: datetime = Field(default_factory=utcnow, sa_column=timestamptz())


class PaperSynthesis(SQLModel, table=True):
    """A literature review over a set, by synthesize-papers. Versioned per set."""

    __tablename__ = "paper_syntheses"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    set_id: uuid.UUID = Field(foreign_key="paper_sets.id", ondelete="CASCADE")
    version: int
    body: dict[str, Any] = Field(sa_column=jsonb(server_default=None))
    citations: list[str] = Field(default_factory=list, sa_column=text_array())  # '<slug>:<anchor>'
    origin: str  # skill:synthesize-papers@<v>
    model: str | None = None
    input_hash: str
    review: Review = Field(default=Review.DRAFT, sa_type=enum_type(Review))
    created_at: datetime = Field(default_factory=utcnow, sa_column=timestamptz())

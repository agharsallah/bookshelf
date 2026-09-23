"""Wire shapes for documents, the library listing and the outline override (§13)."""

import uuid
from datetime import datetime
from typing import Annotated, Any, Self

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from app.models import Document
from app.models.enums import DocumentKind, DocumentStatus, JobKind, JobState
from app.schemas.job import JobPublic
from app.services.documents import DocumentStats

Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
Author = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Tag = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]
Language = Annotated[str, StringConstraints(pattern=r"^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$")]
Year = Annotated[int, Field(ge=-3000, le=3000)]


class LibraryFilePublic(BaseModel):
    """A file under `library/` whose content is not a document yet."""

    model_config = ConfigDict(from_attributes=True)

    path: Annotated[str, Field(examples=["library/meadows-systems.pdf"])]
    size: int
    modified_at: datetime
    kind: DocumentKind
    sha256: str
    suggested_title: str
    suggested_slug: str


class DocumentCreate(BaseModel):
    """Ingest a file already in `library/` (`path`) or a web article (`url`), not both."""

    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={
            "examples": [
                {"path": "library/meadows-systems.pdf", "tags": ["systems"]},
                {"url": "https://example.com/essay", "title": "An essay"},
            ]
        },
    )

    path: Annotated[str | None, Field(default=None, min_length=1, max_length=1024)]
    url: Annotated[str | None, Field(default=None, max_length=2048, pattern=r"^https?://[^\s]+$")]
    title: Annotated[Title | None, Field(default=None)]
    authors: Annotated[list[Author] | None, Field(default=None, max_length=50)]
    year: Annotated[Year | None, Field(default=None)]
    tags: Annotated[list[Tag] | None, Field(default=None, max_length=50)]

    @model_validator(mode="after")
    def _exactly_one_source(self) -> Self:
        if (self.path is None) == (self.url is None):
            raise ValueError("Provide exactly one of `path` or `url`.")
        return self


class DocumentUpdate(BaseModel):
    """Editable metadata. Omitted fields are left alone; `year: null` clears the year."""

    model_config = ConfigDict(extra="forbid")

    # Non-nullable columns: an explicit `null` fails validation (the default is not validated).
    title: Annotated[Title, Field(default=None)]
    authors: Annotated[list[Author], Field(default=None, max_length=50)]
    year: Annotated[Year | None, Field(default=None)]
    tags: Annotated[list[Tag], Field(default=None, max_length=50)]
    language: Annotated[Language, Field(default=None, max_length=16)]


class OutlineSection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]
    page_from: Annotated[int, Field(ge=1)]


class OutlineChapter(BaseModel):
    """One chapter, in the same shape `parse-outline` emits."""

    model_config = ConfigDict(extra="forbid")

    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]
    page_from: Annotated[int, Field(ge=1)]
    page_to: Annotated[int, Field(ge=1)]
    sections: Annotated[list[OutlineSection], Field(default_factory=list, max_length=200)]

    @model_validator(mode="after")
    def _pages_are_ordered(self) -> Self:
        if self.page_to < self.page_from:
            raise ValueError(f"'{self.title}': page_to is before page_from.")
        previous = self.page_from
        for section in self.sections:
            if not self.page_from <= section.page_from <= self.page_to:
                raise ValueError(f"'{section.title}' starts outside its chapter's pages.")
            if section.page_from < previous:
                raise ValueError(f"'{section.title}' starts before the section above it.")
            previous = section.page_from
        return self


class OutlineUpdate(BaseModel):
    """Manual chapter/section fix-up (§8). An empty list removes the override."""

    model_config = ConfigDict(extra="forbid")

    chapters: Annotated[list[OutlineChapter], Field(max_length=500)]

    @model_validator(mode="after")
    def _chapters_do_not_overlap(self) -> Self:
        for before, after in zip(self.chapters, self.chapters[1:], strict=False):
            if after.page_from < before.page_to:
                raise ValueError(f"'{after.title}' starts before '{before.title}' ends.")
        return self


class DocumentPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    kind: DocumentKind
    slug: str
    title: str
    authors: list[str]
    year: int | None
    source_uri: str | None
    source_path: str | None
    sha256: str
    page_count: int | None
    language: str
    status: DocumentStatus
    parse_tier: int | None
    tags: list[str]
    created_at: datetime
    updated_at: datetime


class DocumentCounts(BaseModel):
    chapters: int
    blocks: Annotated[int, Field(description="Leaf nodes (paragraphs, tables, figures, ...).")]
    figures: int
    notes: int


class ArtifactCounts(BaseModel):
    """Artifacts by review state."""

    draft: int = 0
    needs_review: int = 0
    approved: int = 0
    rejected: int = 0


class JobBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    kind: JobKind
    state: JobState
    error: str | None
    created_at: datetime
    finished_at: datetime | None


class PausedState(BaseModel):
    """Why the pipeline stopped spending model runs on this document (§14 run ceiling)."""

    reason: str
    at: datetime
    runs: int
    limit: int


class DocumentSummary(DocumentPublic):
    """A list item: metadata plus what the pipeline has produced so far."""

    counts: DocumentCounts
    artifacts: ArtifactCounts
    latest_job: JobBrief | None
    paused: Annotated[
        PausedState | None,
        Field(description="Set when the run ceiling paused the document; clear it via resume."),
    ] = None

    @classmethod
    def build(cls, document: Document, stats: DocumentStats, **extra: Any) -> Self:
        return cls.model_validate(
            {
                **DocumentPublic.model_validate(document).model_dump(),
                "counts": DocumentCounts(
                    chapters=stats.chapters,
                    blocks=stats.blocks,
                    figures=stats.figures,
                    notes=stats.notes,
                ),
                "artifacts": ArtifactCounts.model_validate(stats.artifacts),
                "latest_job": JobBrief.model_validate(stats.latest_job)
                if stats.latest_job
                else None,
                "paused": document.meta.get("paused"),
                **extra,
            }
        )


class DocumentDetail(DocumentSummary):
    """One document: summary plus the outline override and a jobs tally."""

    outline_override: list[dict[str, Any]] | None
    meta: dict[str, Any]
    jobs: Annotated[
        dict[JobKind, dict[JobState, int]],
        Field(description="Job count by kind, then by state.", examples=[{"parse": {"done": 1}}]),
    ]


class ResumeRequest(BaseModel):
    """Lift a run-ceiling pause. Without `max_runs`, the document gets another full
    allowance (`max_runs_per_document`) on top of the runs it has used."""

    model_config = ConfigDict(extra="forbid")

    max_runs: Annotated[
        int | None, Field(default=None, ge=1, le=100_000, description="New per-document ceiling.")
    ]


class DocumentResumed(BaseModel):
    document: DocumentDetail
    requeued: Annotated[
        list[JobPublic], Field(description="Jobs the ceiling had stopped, queued again.")
    ]


class DocumentAccepted(BaseModel):
    """`202` body: the document and the parse job that will (re)build its tree."""

    document: DocumentPublic
    job: JobPublic
    deduplicated: Annotated[
        bool, Field(description="True when a live job already covered this work.")
    ]

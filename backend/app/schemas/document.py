"""Wire shapes for documents, the library listing and the outline override (§13)."""

import uuid
from datetime import datetime
from typing import Annotated, Any, Self

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)

from app.models import Document
from app.models.enums import DocumentKind, DocumentStatus, Genre, JobKind, JobState
from app.schemas.job import JobPublic
from app.schemas.outline import OverrideChapter, check_chapters
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
    genre: Annotated[
        Genre | None,
        Field(
            default=None,
            description="book | paper | article. Omitted: `article` for a URL, else guessed "
            "after parsing (papers.detect) and `book` until then.",
        ),
    ]

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
    genre: Annotated[Genre, Field(default=None)]


class OutlineUpdate(BaseModel):
    """Manual chapter/section fix-up (§8), in the parser's own override shape and rules
    (`app.schemas.outline`). An empty list removes the override."""

    model_config = ConfigDict(extra="forbid")

    chapters: Annotated[
        list[OverrideChapter], Field(max_length=500), AfterValidator(check_chapters)
    ]


class DocumentPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    kind: DocumentKind
    genre: Genre
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
    archived_at: Annotated[
        datetime | None, Field(description="When it was archived; null while on the shelf.")
    ] = None
    finished_at: Annotated[
        datetime | None,
        Field(description="When it was marked read through; null while not finished."),
    ] = None


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


class CatalogueCard(BaseModel):
    """What `catalogue-document` says the document is (app/pipeline/catalogue.py): the
    preferred `catalogue_entry`, `draft` until a human approves it. Unknowns are null."""

    theme: Annotated[
        str | None, Field(description="The shelf-wide section it is shelved under.")
    ] = None
    subjects: list[str] = []
    form: str | None = None
    audience: str | None = None
    level: str | None = None
    description: Annotated[str | None, Field(description="One sentence: what it offers.")] = None
    publisher: str | None = None
    published: int | None = None
    edition: str | None = None
    isbn: str | None = None
    language: str | None = None
    series: str | None = None
    draft: bool


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
    blurb: Annotated[
        str | None,
        Field(
            description="Card text (≤ 280 chars): the approved book summary's first paragraph, "
            "else the brief's thesis, else the first chapter summary."
        ),
    ] = None
    paused: Annotated[
        PausedState | None,
        Field(description="Set when the run ceiling paused the document; clear it via resume."),
    ] = None
    catalogue: Annotated[
        CatalogueCard | None,
        Field(description="The library card (theme, subjects, facts), once one was written."),
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
                "blurb": stats.blurb,
                "catalogue": stats.catalogue,
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


class DocumentRestored(BaseModel):
    """The document, back on the shelf, and the work its restore queued again."""

    document: DocumentPublic
    requeued: Annotated[
        list[JobPublic],
        Field(description="Jobs the archive held, and the `embed` that re-indexes it."),
    ]


class OutlineConfirmed(BaseModel):
    """The document, now `parsed`, and the first pipeline jobs its confirmation queued."""

    document: DocumentPublic
    jobs: list[JobPublic]


class DocumentAccepted(BaseModel):
    """`202` body: the document and the parse job that will (re)build its tree."""

    document: DocumentPublic
    job: JobPublic
    deduplicated: Annotated[
        bool, Field(description="True when a live job already covered this work.")
    ]

"""Wire models of `/paper-sets` (docs/PAPERS.md §7) beyond the table mirrors in
`schemas/papers.py` (`PaperSetCreate`, `PaperSetPublic`, `PaperSynthesisPublic`)."""

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import Review
from app.schemas.paper_shelf import PaperSummary
from app.schemas.papers import PaperSetPublic, PaperSynthesisPublic
from app.schemas.search import CiteSource


class SynthesisSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    version: int
    review: Review
    created_at: datetime


class PaperSetDetail(PaperSetPublic):
    """A set with its members as shelf rows, in set order (deleted papers left out)."""

    members: list[PaperSummary]
    synthesis: Annotated[
        SynthesisSummary | None,
        Field(description="The latest approved synthesis, else the latest draft; null if none."),
    ]


class PaperSynthesisDetail(PaperSynthesisPublic):
    """`body` is `{blocks, table}` (render contract) whose cites are `<slug>:<anchor>`
    keys of `sources`."""

    sources: Annotated[
        dict[str, CiteSource], Field(description="What each `<slug>:<anchor>` cite points at.")
    ]


class SynthesisReview(BaseModel):
    model_config = ConfigDict(extra="forbid")

    verdict: Literal["approve", "reject"]

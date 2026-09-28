"""Wire models of `GET /papers/compare` (docs/PAPERS.md §5 "Results comparison")."""

import uuid
from typing import Annotated

from pydantic import BaseModel, Field


class ComparedPaper(BaseModel):
    id: uuid.UUID
    slug: str
    title: str
    year: int | None = None
    results_artifact_id: Annotated[
        uuid.UUID | None,
        Field(description="The approved results_table read, or null when the paper has none."),
    ] = None
    rows: Annotated[int, Field(ge=0, description="Result rows it contributed.")] = 0


class ResultColumn(BaseModel):
    key: Annotated[str, Field(description="`<dataset key>|<metric key>`.")]
    dataset: str
    metric: str
    unit: Annotated[str | None, Field(description="The column's most common unit.")] = None
    higher_is_better: bool
    best: Annotated[
        float | None,
        Field(description="The best comparable value; null with fewer than two comparable cells."),
    ] = None
    cells: Annotated[int, Field(ge=0)] = 0


class ResultCell(BaseModel):
    column: str
    paper_id: uuid.UUID
    value: float
    unit: str | None = None
    setting: str | None = None
    is_proposed: Annotated[bool, Field(description="The paper's own method (or a variant).")]
    comparable: Annotated[bool, Field(description="In the column's unit, so ranked.")] = True
    best: bool = False
    cites: Annotated[list[str], Field(description="Qualified `<document_id>#<anchor>`.")]


class ResultRow(BaseModel):
    key: str
    method: Annotated[str, Field(description="A concept's canonical name, or the first spelling.")]
    cells: list[ResultCell]


class ResultsComparison(BaseModel):
    papers: list[ComparedPaper]
    columns: list[ResultColumn]
    rows: list[ResultRow]

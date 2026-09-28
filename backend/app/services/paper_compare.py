"""The results matrix behind `GET /papers/compare` (docs/PAPERS.md §5).

    refs (ids or slugs) → papers (404 for a non-paper) → each one's latest *approved*
    results_table → concepts naming their methods, datasets and metrics (one lookup)
    → `papers.compare.compare` → wire model (cites qualified `<document_id>#<anchor>`)

Concept names come from `papers.compare_names.concept_canon`.
"""

from collections.abc import Sequence

from sqlmodel import Session

from app.models.enums import ArtifactType
from app.papers.compare import Comparison, PaperResults, compare
from app.papers.compare_names import concept_canon
from app.papers.materialize import effective
from app.schemas.paper_compare import (
    ComparedPaper,
    ResultCell,
    ResultColumn,
    ResultRow,
    ResultsComparison,
)
from app.services.errors import InvalidInputError
from app.services.papers import get_paper

MAX_PAPERS = 20


def parse_refs(values: Sequence[str]) -> list[str]:
    """`ids=a,b&ids=c` → `[a, b, c]`, first occurrence kept; 422 if none or too many."""
    refs = list(dict.fromkeys(r.strip() for v in values for r in v.split(",") if r.strip()))
    if not refs:
        raise InvalidInputError("Name at least one paper to compare.", field="ids")
    if len(refs) > MAX_PAPERS:
        raise InvalidInputError(f"Compare at most {MAX_PAPERS} papers.", field="ids")
    return refs


def _wire(comparison: Comparison) -> tuple[list[ResultColumn], list[ResultRow]]:
    columns = [
        ResultColumn(
            key=c.key,
            dataset=c.dataset,
            metric=c.metric,
            unit=c.unit,
            higher_is_better=c.higher_is_better,
            best=c.best,
            cells=len(c.cells),
        )
        for c in comparison.columns
    ]
    rows = [
        ResultRow(
            key=r.key,
            method=r.method,
            cells=[
                ResultCell(
                    column=c.column,
                    paper_id=c.document_id,
                    value=c.value,
                    unit=c.unit,
                    setting=c.setting,
                    is_proposed=c.is_proposed,
                    comparable=c.comparable,
                    best=c.best,
                    cites=[f"{c.document_id}#{a}" for a in c.cites],
                )
                for c in r.cells
            ],
        )
        for r in comparison.rows
    ]
    return columns, rows


def compare_papers(session: Session, refs: Sequence[str]) -> ResultsComparison:
    """The results matrix of the named papers, in the order given."""
    documents = list({d.id: d for d in (get_paper(session, ref) for ref in refs)}.values())
    papers: list[PaperResults] = []
    listed: list[ComparedPaper] = []
    for doc in documents:
        artifact = effective(session, doc.id, ArtifactType.RESULTS_TABLE)
        rows = artifact.body.get("rows", []) if artifact is not None else []
        rows = [r for r in rows if isinstance(r, dict)] if isinstance(rows, list) else []
        papers.append(PaperResults(document_id=doc.id, rows=rows))
        listed.append(
            ComparedPaper(
                id=doc.id,
                slug=doc.slug,
                title=doc.title,
                year=doc.year,
                results_artifact_id=artifact.id if artifact else None,
                rows=len(rows),
            )
        )
    canon = concept_canon(session, (r for p in papers for r in p.rows))
    columns, rows_out = _wire(compare(papers, canon))
    return ResultsComparison(papers=listed, columns=columns, rows=rows_out)

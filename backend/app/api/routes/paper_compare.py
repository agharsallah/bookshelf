"""Results comparison (docs/PAPERS.md §5, §7): `GET /papers/compare?ids=`.

Included before any `/papers/{ref}` router, so `/papers/compare` is not read as a ref.
"""

from typing import Annotated

from fastapi import APIRouter, Query

from app.api.deps import SessionDep
from app.schemas.paper_compare import ResultsComparison
from app.services import paper_compare

router = APIRouter(prefix="/papers", tags=["papers"])


@router.get(
    "/compare",
    response_model=ResultsComparison,
    summary="Compare papers' results",
    description="The approved results tables of the named papers pivoted into methods x "
    "(dataset, metric). Names are joined through concept canonical names and aliases "
    "(link-paper-concepts), else case- and space-insensitively. Per column, `best` marks "
    "the best comparable value (in the column's unit, honouring `higher_is_better`). A "
    "paper without an approved results table is listed with `results_artifact_id: null`.",
)
def compare_papers(
    session: SessionDep,
    ids: Annotated[
        list[str],
        Query(
            description=f"Paper uuids or slugs, comma-separated or repeated "
            f"(1-{paper_compare.MAX_PAPERS}).",
            max_length=4000,
        ),
    ],
) -> ResultsComparison:
    return paper_compare.compare_papers(session, paper_compare.parse_refs(ids))

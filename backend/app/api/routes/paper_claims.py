"""The claim tracker (docs/PAPERS.md P4, §5, §7): a paper's claims and how the shelf bears on
them, one claim's cross-paper relations, the reader's margin marks, and queueing the
cross-paper pass.

Relations are claim ↔ claim edges: accept or reject one with `PATCH /edges/{id}`.

Included before `papers` (so `/papers/claims/relate` is not read as a ref) and before
`documents` (for `/documents/{ref}/claims/marks`).
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import SessionDep
from app.api.routes.documents import DocumentRef
from app.core.security import require_api_key
from app.schemas.paper_claims import ClaimMarks, ClaimRelations, PaperClaims, RelateQueued
from app.services import paper_claims, papers
from app.services.documents import get_document

router = APIRouter(tags=["paper claims"])


@router.post(
    "/papers/claims/relate",
    response_model=RelateQueued,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(require_api_key)],
    summary="Relate claims across papers",
    description="Queues a `relate_claims` job per paper with claims (or for `document`): "
    "close cross-paper claim pairs that were never judged go to `relate-claims`; relations "
    "land as proposed claim ↔ claim edges, `none` as rejected ones.",
)
def relate_claims(
    session: SessionDep,
    document: Annotated[str | None, Query(description="One paper's uuid or slug.")] = None,
) -> RelateQueued:
    doc_id = papers.get_paper(session, document).id if document else None
    return RelateQueued(jobs=paper_claims.queue_relate(session, doc_id))


@router.get(
    "/papers/{ref}/claims",
    response_model=PaperClaims,
    summary="A paper's claims, with the shelf's verdicts on them",
    description="Claims of the approved claim_set grouped by unit in reading order, each with "
    "counts of accepted relations (supported / contradicted / extended by, supports, extends) "
    "and of relations awaiting review.",
)
def get_paper_claims(ref: DocumentRef, session: SessionDep) -> PaperClaims:
    return paper_claims.paper_claims(session, papers.get_paper(session, ref))


@router.get(
    "/claims/{claim_id}/relations",
    response_model=ClaimRelations,
    summary="One claim's relations to other papers' claims",
)
def get_claim_relations(claim_id: uuid.UUID, session: SessionDep) -> ClaimRelations:
    return paper_claims.claim_relations(session, claim_id)


@router.get(
    "/documents/{ref}/claims/marks",
    response_model=ClaimMarks,
    summary="Claim marks for the reader's margin",
    description="Evidence anchor → the claims resting on it and the accepted verdicts of other "
    "papers on them. `unit` limits the marks to one unit (a top-level section anchor).",
)
def get_claim_marks(
    ref: DocumentRef,
    session: SessionDep,
    unit: Annotated[
        str | None,
        Query(max_length=200, pattern=r"^[a-z]+[0-9]+(/[a-z]+[0-9]+)*$"),
    ] = None,
) -> ClaimMarks:
    return paper_claims.claim_marks(session, get_document(session, ref), unit)

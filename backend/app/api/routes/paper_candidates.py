"""What to read next (docs/PAPERS.md §5, §7): ranked candidates, the watch list, and adding
a candidate to the shelf. Scores are deterministic (P6); slow work runs as jobs (`202`).

Included before any `/papers/{ref}` router, so `/papers/candidates` is not read as a ref.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import LimitDep, OffsetDep, SessionDep
from app.core.security import require_api_key
from app.models.enums import CandidateStatus
from app.schemas.common import Page
from app.schemas.job import JobPublic
from app.schemas.papers import CandidateUpdate, ReadingCandidatePublic
from app.services import paper_candidates

router = APIRouter(prefix="/papers", tags=["paper candidates"])


@router.get(
    "/candidates",
    response_model=Page[ReadingCandidatePublic],
    summary="The reading queue, best first",
    description="Candidates ranked by `score`; `score_parts` names every term of it. Without "
    "`status`, the live queue (`suggested` and `queued`).",
)
def list_candidates(
    session: SessionDep,
    status_: Annotated[CandidateStatus | None, Query(alias="status")] = None,
    limit: LimitDep = 50,
    offset: OffsetDep = 0,
) -> Page[ReadingCandidatePublic]:
    rows, total = paper_candidates.list_candidates(session, status_, limit=limit, offset=offset)
    return Page(
        items=[ReadingCandidatePublic.model_validate(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post(
    "/candidates/refresh",
    response_model=JobPublic,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(require_api_key)],
    summary="Rebuild and rescore the candidates",
    description="Queues `paper_candidates`: references, citing and related works (OpenAlex), "
    "abstract similarity to papers you rated 4+, scored, then `recommend_next` for the top.",
)
def refresh_candidates(session: SessionDep) -> JobPublic:
    return JobPublic.model_validate(paper_candidates.queue_refresh(session))


@router.patch(
    "/candidates/{candidate_id}",
    response_model=ReadingCandidatePublic,
    dependencies=[Depends(require_api_key)],
    summary="Queue, dismiss or restore a candidate",
    description="A dismissed candidate is never suggested again by a rebuild. `ingested` "
    "is `422` here (use `/ingest`); a candidate already on the shelf is `409`.",
)
def update_candidate(
    candidate_id: uuid.UUID, body: CandidateUpdate, session: SessionDep
) -> ReadingCandidatePublic:
    candidate = paper_candidates.set_status(session, candidate_id, body.status)
    return ReadingCandidatePublic.model_validate(candidate)


@router.post(
    "/candidates/{candidate_id}/ingest",
    response_model=JobPublic,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(require_api_key)],
    summary="Download the candidate's PDF and add it to the shelf",
    description="Queues `paper_fetch`: the open-access PDF (arXiv first) goes to "
    "`library/papers/` and is ingested as a paper. `422` without an open-access PDF.",
)
def ingest_candidate(candidate_id: uuid.UUID, session: SessionDep) -> JobPublic:
    return JobPublic.model_validate(paper_candidates.queue_ingest(session, candidate_id))


@router.post(
    "/watch/refresh",
    response_model=JobPublic,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(require_api_key)],
    summary="Look for new works citing your favourite papers",
    description="Queues `paper_watch` for papers rated 4+. Each paper is checked at most "
    "once a week unless `force=true`; new citers become candidates with source `watch`.",
)
def refresh_watch(
    session: SessionDep,
    force: Annotated[bool, Query(description="Check papers checked this week too.")] = False,
) -> JobPublic:
    return JobPublic.model_validate(paper_candidates.queue_watch(session, force=force))

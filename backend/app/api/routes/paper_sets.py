"""Paper sets and their syntheses (docs/PAPERS.md §5, §7): group papers, have them
synthesized into a related-work section with a comparison table, review each version.

A synthesis is slow model work, so `POST …/synthesis` queues `synthesize_papers` (`202`);
an unchanged input returns the existing version without a model run unless `force`.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status

from app.api.deps import LimitDep, OffsetDep, SessionDep
from app.core.security import require_api_key
from app.schemas.common import Page
from app.schemas.job import JobPublic
from app.schemas.paper_sets import (
    PaperSetDetail,
    PaperSynthesisDetail,
    SynthesisReview,
    SynthesisSummary,
)
from app.schemas.paper_shelf import PaperSummary
from app.schemas.papers import PaperSetCreate, PaperSetPublic, PaperSynthesisPublic
from app.services import paper_sets, papers

router = APIRouter(prefix="/paper-sets", tags=["paper sets"])


@router.post(
    "",
    response_model=PaperSetPublic,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_api_key)],
    summary="Group papers into a set",
    description="`document_ids` in reading order (duplicates dropped); each must be a paper "
    "on the shelf, else `422`.",
)
def create_set(body: PaperSetCreate, session: SessionDep) -> PaperSetPublic:
    return PaperSetPublic.model_validate(
        paper_sets.create_set(session, body.name, body.document_ids)
    )


@router.get("", response_model=Page[PaperSetPublic], summary="Every paper set, newest first")
def list_sets(
    session: SessionDep, limit: LimitDep = 50, offset: OffsetDep = 0
) -> Page[PaperSetPublic]:
    rows, total = paper_sets.list_sets(session, limit=limit, offset=offset)
    return Page(
        items=[PaperSetPublic.model_validate(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/{set_id}",
    response_model=PaperSetDetail,
    summary="A set with its papers",
    description="`members` are shelf rows (meta, latest rating, passes, artifact states) in "
    "set order; `synthesis` names the version `GET …/synthesis` serves.",
)
def get_set(set_id: uuid.UUID, session: SessionDep) -> PaperSetDetail:
    paper_set = paper_sets.get_set(session, set_id)
    members = [PaperSummary.build(f) for f in papers.paper_facts(session, paper_set.document_ids)]
    latest = paper_sets.latest_version(session, set_id)
    return PaperSetDetail(
        **PaperSetPublic.model_validate(paper_set).model_dump(),
        members=members,
        synthesis=SynthesisSummary.model_validate(latest) if latest else None,
    )


@router.delete(
    "/{set_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_api_key)],
    summary="Delete a set and its syntheses",
    description="Idempotent: `204` whether or not the set existed. The papers stay.",
)
def delete_set(set_id: uuid.UUID, session: SessionDep) -> Response:
    paper_sets.delete_set(session, set_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{set_id}/synthesis",
    response_model=JobPublic,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(require_api_key)],
    summary="Synthesize the set",
    description="Queues `synthesize_papers` (the live job on repeat). An unchanged input "
    "keeps its version unless `force`. `422` with fewer than two papers.",
)
def queue_synthesis(
    set_id: uuid.UUID, session: SessionDep, force: Annotated[bool, Query()] = False
) -> JobPublic:
    return JobPublic.model_validate(paper_sets.queue_synthesis(session, set_id, force=force))


@router.get(
    "/{set_id}/synthesis",
    response_model=PaperSynthesisDetail,
    summary="The set's synthesis",
    description="Without `version`: the latest approved, else the latest draft. Cites are "
    "`<slug>:<anchor>` keys of `sources`. `404` before the first synthesis.",
)
def get_synthesis(
    set_id: uuid.UUID,
    session: SessionDep,
    version: Annotated[int | None, Query(ge=1)] = None,
) -> PaperSynthesisDetail:
    row = paper_sets.get_synthesis(session, set_id, version)
    return PaperSynthesisDetail(
        **PaperSynthesisPublic.model_validate(row).model_dump(),
        sources=paper_sets.sources(session, row.citations),
    )


@router.post(
    "/{set_id}/synthesis/{version}/review",
    response_model=PaperSynthesisPublic,
    dependencies=[Depends(require_api_key)],
    summary="Approve or reject a synthesis version",
)
def review_synthesis(
    set_id: uuid.UUID, version: int, body: SynthesisReview, session: SessionDep
) -> PaperSynthesisPublic:
    row = paper_sets.review_synthesis(session, set_id, version, body.verdict)
    return PaperSynthesisPublic.model_validate(row)

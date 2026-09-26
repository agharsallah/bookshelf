"""Concepts (§11, §13): typeahead, concept pages with cross-book evidence, human curation.

Reads are open; writes need `X-API-Key` and are recorded as `origin = human`. Merges are
only ever applied here, by a person (§11); the dedup pass merely proposes them. A write
that changes which names exist re-scans the shelf for mentions (`app.graph.mentions`).
"""

import uuid

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import LimitDep, OffsetDep, SessionDep
from app.core.errors import ConflictError, NotFoundError
from app.core.security import require_api_key
from app.graph import curation, mentions, merge, views
from app.models import Concept
from app.models.enums import ConceptKind
from app.schemas.common import Page
from app.schemas.graph import (
    ConceptCreate,
    ConceptDetail,
    ConceptPublic,
    ConceptSummary,
    ConceptUpdate,
    MergeProposal,
    MergeRequest,
)

router = APIRouter(prefix="/concepts", tags=["concepts"])


def _get(session: SessionDep, concept_id: uuid.UUID) -> Concept:
    concept = session.get(Concept, concept_id)
    if concept is None:
        raise NotFoundError(f"Concept {concept_id} does not exist.")
    return concept


@router.get("", response_model=Page[ConceptSummary], summary="Typeahead over names and aliases")
def list_concepts(
    session: SessionDep,
    q: str | None = Query(default=None, max_length=200, description="Name or alias fragment."),
    kind: ConceptKind | None = Query(default=None),
    sort: views.ConceptSort = Query(
        default="alpha", description="`alpha` by name, `connected` most edges, `recent` newest."
    ),
    limit: LimitDep = 20,
    offset: OffsetDep = 0,
) -> Page[ConceptSummary]:
    """Live (unmerged) concepts with their `edge_count`. With `q`: exact name, name prefix,
    exact alias, alias prefix, then substring matches, in that order (`sort` breaks ties)."""
    items, total = views.search_concepts(session, q, kind, limit, offset, sort)
    return Page(items=items, total=total, limit=limit, offset=offset)


@router.get(
    "/merge-proposals",
    response_model=list[MergeProposal],
    summary="Proposed same_as merges waiting for a human",
)
def list_merge_proposals(session: SessionDep, limit: LimitDep = 50) -> list[MergeProposal]:
    return views.merge_proposals(session, limit)


@router.get("/{concept_id}", response_model=ConceptDetail, summary="A concept and its evidence")
def get_concept(concept_id: uuid.UUID, session: SessionDep) -> ConceptDetail:
    """Edges grouped by relation, each with its evidence passages across documents. A merged
    concept comes back with `merged_into` set and no edges (they moved to the survivor)."""
    return views.concept_detail(session, _get(session, concept_id))


@router.post(
    "",
    response_model=ConceptPublic,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_api_key)],
    summary="Create a concept by hand",
)
def create_concept(body: ConceptCreate, session: SessionDep) -> ConceptPublic:
    concept = curation.create_concept(
        session,
        canonical=body.canonical,
        kind=body.kind,
        aliases=body.aliases,
        blurb=body.blurb,
        blurb_cites=body.blurb_cites,
    )
    mentions.seed_all(session)
    return ConceptPublic.model_validate(concept)


@router.patch(
    "/{concept_id}",
    response_model=ConceptPublic,
    dependencies=[Depends(require_api_key)],
    summary="Rename, re-alias or re-blurb a concept",
)
def update_concept(
    concept_id: uuid.UUID, body: ConceptUpdate, session: SessionDep
) -> ConceptPublic:
    """A rename keeps the old canonical as an alias; names stay unique across concepts."""
    concept = curation.update_concept(
        session,
        _get(session, concept_id),
        canonical=body.canonical,
        kind=body.kind,
        aliases=body.aliases,
        blurb=body.blurb,
        blurb_cites=body.blurb_cites,
        clear_blurb="blurb" in body.model_fields_set and body.blurb is None,
    )
    if body.canonical is not None or body.aliases is not None:
        mentions.seed_all(session)
    return ConceptPublic.model_validate(concept)


@router.post(
    "/{concept_id}/merge",
    response_model=ConceptPublic,
    dependencies=[Depends(require_api_key)],
    summary="Merge this concept into another (the survivor is returned)",
)
def merge_concept(concept_id: uuid.UUID, body: MergeRequest, session: SessionDep) -> ConceptPublic:
    _get(session, concept_id)
    _get(session, body.into)
    try:
        survivor = merge.merge(session, concept_id, body.into)
    except merge.MergeError as exc:
        raise ConflictError(str(exc)) from exc
    mentions.seed_all(session)
    return ConceptPublic.model_validate(survivor)


@router.post(
    "/{concept_id}/unmerge",
    response_model=ConceptPublic,
    dependencies=[Depends(require_api_key)],
    summary="Undo a merge (the restored concept is returned)",
)
def unmerge_concept(concept_id: uuid.UUID, session: SessionDep) -> ConceptPublic:
    _get(session, concept_id)
    try:
        restored = merge.unmerge(session, concept_id)
    except merge.MergeError as exc:
        raise ConflictError(str(exc)) from exc
    mentions.seed_all(session)
    return ConceptPublic.model_validate(restored)

"""Artifacts (§13): the review queue, version history, human writes, interactive imports.

Reads are open; writes need `X-API-Key`. Every approval (approve, edit, human write)
propagates upward through the orchestrator, e.g. a corrected section note re-queues its
chapter distillation (§7).
"""

import uuid
from typing import Any

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import cast, exists, func, literal, or_
from sqlalchemy.dialects.postgresql import JSONPATH
from sqlalchemy.orm import aliased
from sqlmodel import col, select

from app.api.deps import LimitDep, OffsetDep, SessionDep
from app.api.pipeline import SkillsDirDep, pipeline_errors
from app.core.errors import NotFoundError
from app.core.security import require_api_key
from app.models import Artifact, Document
from app.models.enums import ArtifactType, Review
from app.pipeline import authoring, interactive
from app.schemas.artifact import (
    ArtifactCreate,
    ArtifactImport,
    ArtifactListItem,
    ArtifactPublic,
    CalloutTone,
    ReviewRequest,
)
from app.schemas.common import Page

router = APIRouter(prefix="/artifacts", tags=["artifacts"])

# Any callout of the given tone, at any depth of the body (write-brief nests blocks).
# `strict`: lax mode auto-unwraps arrays under `.**` and returns each match twice.
_TONE_PATH = 'strict $.** ? (@.type == "callout" && @.tone == $tone)'


_Newer = aliased(Artifact)
# A newer live (non-rejected) version of the same scope exists: e.g. a human edit, or a
# re-run. Scope = (document, anchor, type, note, variant), so two notes on one anchor, or
# two episodes of one book's audio summary, stay apart.
SUPERSEDED = exists().where(
    col(_Newer.document_id) == col(Artifact.document_id),
    col(_Newer.type) == col(Artifact.type),
    col(_Newer.anchor).is_not_distinct_from(Artifact.anchor),
    col(_Newer.note_id).is_not_distinct_from(Artifact.note_id),
    col(_Newer.variant).is_not_distinct_from(Artifact.variant),
    col(_Newer.version) > col(Artifact.version),
    col(_Newer.review) != Review.REJECTED,
)


def _get(session: SessionDep, artifact_id: uuid.UUID) -> Artifact:
    artifact = session.get(Artifact, artifact_id)
    if artifact is None:
        raise NotFoundError(f"Artifact {artifact_id} does not exist.")
    return artifact


@router.get("", response_model=Page[ArtifactListItem], summary="List artifacts (review queue)")
def list_artifacts(
    session: SessionDep,
    limit: LimitDep = 50,
    offset: OffsetDep = 0,
    document_id: uuid.UUID | None = Query(default=None),
    type: ArtifactType | None = Query(default=None),
    review: Review | None = Query(default=None),
    tone: CalloutTone | None = Query(
        default=None, description="Only artifacts containing a callout of this tone."
    ),
    anchor_prefix: str | None = Query(
        default=None, max_length=200, pattern=r"^[a-z]+[0-9]+(/[a-z]+[0-9]+)*$"
    ),
    latest: bool = Query(
        default=False,
        description="Hide superseded rows: only versions no newer live version replaces.",
    ),
) -> Page[ArtifactListItem]:
    """Newest first. Each item says whether it is `superseded` by a newer live version of
    its scope; `?latest=true&review=draft` is the work still to do."""
    filters: list[Any] = []
    if document_id is not None:
        filters.append(Artifact.document_id == document_id)
    if type is not None:
        filters.append(Artifact.type == type)
    if review is not None:
        filters.append(Artifact.review == review)
    if anchor_prefix is not None:
        below = col(Artifact.anchor).startswith(anchor_prefix + "/")
        filters.append(or_(col(Artifact.anchor) == anchor_prefix, below))
    path = cast(literal(_TONE_PATH), JSONPATH)
    tone_vars = func.jsonb_build_object("tone", tone)
    if tone is not None:
        filters.append(func.jsonb_path_exists(Artifact.body, path, tone_vars))
    if latest:
        filters.append(~SUPERSEDED)

    total = session.exec(select(func.count()).select_from(Artifact).where(*filters)).one()
    matched = func.jsonb_path_query_array(Artifact.body, path, tone_vars) if tone else literal(None)
    rows = session.exec(
        select(Artifact, matched, SUPERSEDED.label("superseded"))
        .where(*filters)
        .order_by(col(Artifact.created_at).desc(), col(Artifact.version).desc())
        .offset(offset)
        .limit(limit)
    ).all()
    items = [
        ArtifactListItem.model_validate(artifact).model_copy(
            update={"matched_blocks": blocks, "superseded": superseded}
        )
        for artifact, blocks, superseded in rows
    ]
    return Page(items=items, total=int(total), limit=limit, offset=offset)


@router.get("/{artifact_id}", response_model=ArtifactPublic, summary="Get one artifact")
def get_artifact(artifact_id: uuid.UUID, session: SessionDep) -> ArtifactPublic:
    return ArtifactPublic.model_validate(_get(session, artifact_id))


@router.get(
    "/{artifact_id}/versions",
    response_model=list[ArtifactPublic],
    summary="Every version of this artifact's scope, oldest first",
)
def list_versions(artifact_id: uuid.UUID, session: SessionDep) -> list[ArtifactPublic]:
    artifact = _get(session, artifact_id)
    same_anchor = (
        col(Artifact.anchor).is_(None)
        if artifact.anchor is None
        else Artifact.anchor == artifact.anchor
    )
    rows = session.exec(
        select(Artifact)
        .where(
            Artifact.document_id == artifact.document_id,
            Artifact.type == artifact.type,
            same_anchor,
            # Two notes on one anchor each have their own structured_note history.
            col(Artifact.note_id).is_(None)
            if artifact.note_id is None
            else Artifact.note_id == artifact.note_id,
            col(Artifact.variant).is_not_distinct_from(artifact.variant),
        )
        .order_by(col(Artifact.version))
    ).all()
    return [ArtifactPublic.model_validate(row) for row in rows]


@router.post(
    "",
    response_model=ArtifactPublic,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_api_key)],
    summary="Write an artifact by hand (origin = human)",
)
def create_artifact(
    body: ArtifactCreate, session: SessionDep, skills_dir: SkillsDirDep
) -> ArtifactPublic:
    document = session.get(Document, body.document_id)
    if document is None:
        raise NotFoundError(f"Document {body.document_id} does not exist.")
    with pipeline_errors():
        artifact = authoring.create_human_artifact(
            session,
            document,
            body.type,
            body.body,
            anchor=body.anchor,
            note_id=body.note_id,
            skills_dir=skills_dir,
        )
    return ArtifactPublic.model_validate(artifact)


@router.post(
    "/import",
    response_model=ArtifactPublic,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_api_key)],
    summary="Import an interactive-mode skill result",
)
def import_artifact(
    body: ArtifactImport, session: SessionDep, skills_dir: SkillsDirDep
) -> ArtifactPublic:
    with pipeline_errors():
        artifact = interactive.import_output(
            session,
            skill=body.skill,
            document=body.document,
            anchor=body.anchor,
            input_hash=body.input_hash,
            output=body.output,
            note_id=body.note_id,
            params=body.params,
            model=body.model,
            force=body.force,
            skills_dir=skills_dir,
        )
    return ArtifactPublic.model_validate(artifact)


@router.post(
    "/{artifact_id}/review",
    response_model=ArtifactPublic,
    dependencies=[Depends(require_api_key)],
    summary="Approve, reject, edit (a new human version) or reopen (back to draft)",
    description=(
        "`reopen` undoes a verdict: approved or rejected → `draft`, `reviewed_at` cleared. "
        "`409` when the artifact is not approved/rejected, or when reopening a rejected row "
        "would give its input a second live artifact. Nothing built on the verdict is "
        "undone, except that the idea graph follows reopened concept links and search "
        "drops a reopened approved distillation at the next (queued) embed."
    ),
)
def review_artifact(
    artifact_id: uuid.UUID, body: ReviewRequest, session: SessionDep, skills_dir: SkillsDirDep
) -> ArtifactPublic:
    artifact = _get(session, artifact_id)
    with pipeline_errors():
        result = authoring.review(
            session, artifact, body.action, body=body.body, skills_dir=skills_dir
        )
    return ArtifactPublic.model_validate(result)

"""Skill catalogue and interactive inputs (§7 "No API key").

`GET /skills/{name}/inputs` returns the exact JSON and `input_hash` the batch runner would
use for a scope, so an interactive Claude Code session works on the same inputs and its
result imports cleanly through `POST /artifacts/import`.
"""

import uuid

from fastapi import APIRouter, Query

from app.api.deps import SessionDep
from app.api.pipeline import SkillsDirDep, pipeline_errors
from app.core.errors import NotFoundError
from app.pipeline import execution
from app.pipeline.skills import Skill, load_catalogue
from app.schemas.skill import SkillGates, SkillInputs, SkillPublic

router = APIRouter(prefix="/skills", tags=["skills"])


def _public(skill: Skill) -> SkillPublic:
    meta = skill.meta
    return SkillPublic(
        name=meta.name,
        version=meta.version,
        description=meta.description,
        tier=meta.tier,
        job_kind=meta.job_kind,
        artifact_type=meta.artifact_type,
        scope=meta.scope,
        selector=meta.selector,
        vision=meta.vision,
        gates=SkillGates.model_validate(meta.gates.model_dump()),
    )


@router.get("", response_model=list[SkillPublic], summary="List skill packages")
def list_skills(skills_dir: SkillsDirDep) -> list[SkillPublic]:
    return [_public(s) for s in load_catalogue(skills_dir).values()]


@router.get(
    "/{name}/inputs",
    response_model=SkillInputs,
    summary="The exact inputs and input_hash a batch run would use",
)
def skill_inputs(
    name: str,
    session: SessionDep,
    skills_dir: SkillsDirDep,
    document: str = Query(max_length=200, description="Document slug or id."),
    anchor: str | None = Query(default=None, max_length=200),
    note_id: uuid.UUID | None = Query(default=None),
) -> SkillInputs:
    skill = load_catalogue(skills_dir).get(name)
    if skill is None:
        raise NotFoundError(f"Skill {name} does not exist.")
    doc = execution.find_document(session, document)
    if doc is None:
        raise NotFoundError(f"Document {document} does not exist.")
    with pipeline_errors():
        prepared = execution.prepare(session, skill, doc, anchor, note_id=note_id)
    return SkillInputs(
        skill=skill.name,
        skill_version=skill.version,
        document_id=doc.id,
        anchor=anchor,
        input_hash=prepared.input_hash,
        inputs=prepared.selection.inputs,
    )

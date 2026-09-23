"""Run one skill-backed job end to end (§7 sequence diagram).

    select inputs → input_hash → live artifact for (type, hash, version)? → skip
                                                         else → render → claude -p
    → hard gates (schema, anchors; retry once) → soft gates → insert artifact

Interactive imports reuse `prepare` and `build_artifact`, so both run modes produce the
same rows through the same gates.
"""

import logging
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from sqlmodel import Session, col, func, select

from app.core.config import get_settings
from app.jobs.registry import HandlerResult, PermanentJobError
from app.models import Artifact, Document, Job
from app.models.enums import ArtifactType, JobKind, JobState, Origin, RunMode
from app.pipeline import artifacts, gates
from app.pipeline.bodies import plain_text
from app.pipeline.hashing import input_hash
from app.pipeline.runner import ModelRunner, OutputError, run_structured
from app.pipeline.selectors import Selection, SelectorError, select_inputs
from app.pipeline.skills import Skill, load_catalogue, render_prompt, skill_for_job_kind
from app.pipeline.tree import Tree

logger = logging.getLogger(__name__)

# Every JobKind whose work is a skill run (parse, embed, export are plain Python).
SKILL_JOB_KINDS = frozenset(
    {
        JobKind.DESCRIBE_FIGURE,
        JobKind.EXPLAIN_CODE,
        JobKind.DESCRIBE_MATH,
        JobKind.EXPLAIN_TABLE,
        JobKind.SUMMARIZE,
        JobKind.DISTIL_SECTION,
        JobKind.DISTIL_CHAPTER,
        JobKind.BRIEF,
        JobKind.STRUCTURE_NOTE,
        JobKind.LINK_CONCEPTS,
        JobKind.DERIVE,
    }
)


@dataclass(frozen=True, slots=True)
class Prepared:
    """A skill bound to one scope: its exact inputs and their hash."""

    skill: Skill
    document: Document
    anchor: str | None
    note_id: uuid.UUID | None
    selection: Selection
    input_hash: str

    @property
    def artifact_type(self) -> ArtifactType:
        if self.skill.meta.artifact_type is None:
            raise SelectorError(f"{self.skill.name} is interactive-only and stores no artifact")
        return self.skill.meta.artifact_type


def find_document(session: Session, ref: str | uuid.UUID) -> Document | None:
    """A document by id or slug."""
    if isinstance(ref, uuid.UUID):
        return session.get(Document, ref)
    try:
        return session.get(Document, uuid.UUID(ref))
    except ValueError:
        return session.exec(select(Document).where(Document.slug == ref)).first()


def prepare(
    session: Session,
    skill: Skill,
    document: Document,
    anchor: str | None,
    *,
    note_id: uuid.UUID | None = None,
    media_dir: Path | None = None,
) -> Prepared:
    selection = select_inputs(
        session, skill.meta.selector, document, anchor, note_id=note_id, media_dir=media_dir
    )
    if anchor is None and note_id is not None:  # a note's scope is the passage it annotates
        anchor = selection.inputs.get("scope", {}).get("anchor")
    return Prepared(
        skill=skill,
        document=document,
        anchor=anchor,
        note_id=note_id,
        selection=selection,
        input_hash=input_hash(skill.name, skill.version, selection.inputs),
    )


def sibling_texts(session: Session, prepared: Prepared) -> dict[str, str]:
    """Other section notes of the same chapter, for the duplication gate."""
    if prepared.artifact_type is not ArtifactType.SECTION_NOTE or prepared.anchor is None:
        return {}
    tree = Tree.load(session, prepared.document)
    node = tree.by_anchor.get(prepared.anchor)
    chapter = tree.chapter_of(node) if node is not None else None
    if chapter is None:
        return {}
    kind = ArtifactType.SECTION_NOTE
    notes = artifacts.preferred(session, prepared.document.id, [kind])
    return {
        scope.anchor: plain_text(notes[(kind, scope.anchor)].body)
        for scope in tree.section_scopes(chapter)
        if scope.anchor != prepared.anchor and (kind, scope.anchor) in notes
    }


def output_problems(prepared: Prepared, output: dict[str, Any]) -> list[str]:
    return gates.output_problems(prepared.skill.schema, output, prepared.selection.valid_anchors)


def build_artifact(
    session: Session,
    prepared: Prepared,
    output: dict[str, Any],
    *,
    run_mode: RunMode,
    model: str | None,
    schema_retry: bool = False,
) -> Artifact:
    """Score an output that passed the hard gates and wrap it in an unsaved artifact."""
    report = gates.evaluate(
        output,
        config=prepared.skill.meta.gates,
        valid_anchors=prepared.selection.valid_anchors,
        source_words=prepared.selection.source_words,
        element=prepared.selection.element,
        siblings=sibling_texts(session, prepared),
        schema_retry=schema_retry,
    )
    return Artifact(
        document_id=prepared.document.id,
        anchor=prepared.anchor,
        note_id=prepared.note_id,
        type=prepared.artifact_type,
        version=0,  # assigned on insert
        origin=Origin.SKILL,
        skill=prepared.skill.name,
        skill_version=prepared.skill.version,
        model=model,
        run_mode=run_mode,
        tier=prepared.skill.meta.tier,
        input_hash=prepared.input_hash,
        body=output,
        citations=artifacts.citations_of(output),
        gates=report.as_json(),
        review=report.review,
    )


# --- The batch handler body ---------------------------------------------------------


def resolve_skill(catalogue: dict[str, Skill], job: Job) -> Skill:
    if job.kind is JobKind.DERIVE:
        name = job.skill or job.payload.get("skill")
        skill = catalogue.get(name) if isinstance(name, str) else None
        if skill is None:
            raise PermanentJobError(f"derive job names no known skill (got {name!r})")
        return skill
    skill = skill_for_job_kind(catalogue, job.kind)
    if skill is None:
        raise PermanentJobError(f"no skill package declares job_kind {job.kind.value}")
    return skill


def check_run_ceiling(session: Session, job: Job, limit: int) -> None:
    """§14 Run ceiling: stop paying for a document that keeps consuming CLI runs."""
    runs = session.exec(
        select(func.count())
        .select_from(Job)
        .where(
            Job.document_id == job.document_id,
            Job.id != job.id,
            col(Job.kind).in_(list(SKILL_JOB_KINDS)),
            col(Job.state).in_([JobState.DONE, JobState.FAILED]),
        )
    ).one()
    if runs >= limit:
        raise PermanentJobError(
            f"run ceiling reached: {runs} skill runs for this document "
            f"(max_runs_per_document={limit}); raise the limit or review the document"
        )


def _note_id(job: Job) -> uuid.UUID | None:
    raw = job.payload.get("note_id")
    if raw is None:
        return None
    try:
        return uuid.UUID(str(raw))
    except ValueError as exc:
        raise PermanentJobError(f"payload.note_id is not a uuid: {raw!r}") from exc


def execute_skill_job(
    session: Session,
    job: Job,
    *,
    runner: ModelRunner,
    skills_dir: Path | None = None,
    media_dir: Path | None = None,
    max_runs: int | None = None,
) -> HandlerResult:
    settings = get_settings()
    skill = resolve_skill(load_catalogue(skills_dir or settings.skills_dir), job)
    if skill.meta.job_kind is None or skill.meta.artifact_type is None:
        return HandlerResult(
            state=JobState.SKIPPED, result={"reason": f"{skill.name} is interactive-only"}
        )
    document = session.get(Document, job.document_id) if job.document_id else None
    if document is None:
        raise PermanentJobError("skill jobs need an existing document_id")
    job.skill, job.skill_version = skill.name, skill.version

    try:
        prepared = prepare(
            session, skill, document, job.anchor, note_id=_note_id(job), media_dir=media_dir
        )
    except SelectorError as exc:
        raise PermanentJobError(f"cannot select inputs: {exc}") from exc

    force = bool(job.payload.get("force"))
    existing = artifacts.find_live(
        session, prepared.artifact_type, prepared.input_hash, skill.version
    )
    if existing is not None and not force:
        return _skipped(existing, prepared)

    check_run_ceiling(session, job, max_runs or settings.max_runs_per_document)
    prompt = render_prompt(skill.prompt, prepared.selection.inputs)
    try:
        run = run_structured(
            runner,
            prompt,
            tier=skill.meta.tier,
            validate=lambda output: output_problems(prepared, output),
            images=prepared.selection.images if skill.meta.vision else (),
        )
    except OutputError as exc:
        raise PermanentJobError(f"output rejected after one retry: {exc}") from exc

    artifact = build_artifact(
        session,
        prepared,
        run.output,
        run_mode=RunMode.BATCH,
        model=run.model,
        schema_retry=run.retried,
    )
    try:
        artifact = artifacts.insert(session, artifact, supersede=force)
    except artifacts.ArtifactExistsError as exc:  # a concurrent worker got there first
        return _skipped(exc.existing, prepared)
    logger.info(
        "Artifact stored",
        extra={
            "skill": skill.name,
            "artifact_id": str(artifact.id),
            "review": artifact.review.value,
            "grounding": artifact.gates.get("grounding"),
        },
    )
    return HandlerResult(
        result={
            "artifact_id": str(artifact.id),
            "version": artifact.version,
            "review": artifact.review.value,
            "input_hash": prepared.input_hash,
            "gates": artifact.gates,
            "model": run.model,
        },
        cost_tokens=run.cost_tokens,
    )


def _skipped(existing: Artifact, prepared: Prepared) -> HandlerResult:
    return HandlerResult(
        state=JobState.SKIPPED,
        result={
            "reason": "unchanged input",
            "artifact_id": str(existing.id),
            "input_hash": prepared.input_hash,
        },
    )

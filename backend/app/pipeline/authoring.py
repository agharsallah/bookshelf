"""Human authorship and review (D15, §9): write, approve, reject, edit.

Humans and skills author the same artifact types. A human artifact passes the hard gates
(schema, anchor validity) and skips the soft ones; it is approved on arrival. Editing a
skill draft never rewrites it: the edit is a new version with `origin = human`, and the
skill's version stays for diffing. Every review propagates via the orchestrator.
"""

import uuid
from pathlib import Path
from typing import Any, Literal

from sqlmodel import Session

from app.core.config import get_settings
from app.models import Artifact, Document, Note
from app.models.enums import ArtifactType, Origin, Review
from app.pipeline import artifacts, gates, orchestrator
from app.pipeline.runner import OutputError
from app.pipeline.selectors import SelectorError
from app.pipeline.skills import GateConfig, load_catalogue, skill_for_artifact_type

ReviewAction = Literal["approve", "reject", "edit"]


def schema_for_type(kind: ArtifactType, skills_dir: Path | None = None) -> dict[str, Any]:
    """The schema of the skill that produces `kind`, else the bare render contract."""
    skill = skill_for_artifact_type(load_catalogue(skills_dir or get_settings().skills_dir), kind)
    return skill.schema if skill is not None else gates.RENDER_BODY_SCHEMA


def check_human_body(
    session: Session,
    document_id: uuid.UUID,
    kind: ArtifactType,
    body: dict[str, Any],
    *,
    skills_dir: Path | None = None,
) -> dict[str, Any]:
    """Hard gates only (D15 human bypass). Returns the gate record; raises `OutputError`."""
    anchors = artifacts.document_anchors(session, document_id)
    problems = gates.output_problems(schema_for_type(kind, skills_dir), body, anchors)
    if problems:
        raise OutputError(problems)
    report = gates.evaluate(
        body,
        config=GateConfig(),
        valid_anchors=anchors,
        source_words=0,
        origin=Origin.HUMAN,
    )
    return report.as_json()


def create_human_artifact(
    session: Session,
    document: Document,
    kind: ArtifactType,
    body: dict[str, Any],
    *,
    anchor: str | None = None,
    note_id: uuid.UUID | None = None,
    skills_dir: Path | None = None,
) -> Artifact:
    if anchor is not None and anchor not in artifacts.document_anchors(session, document.id):
        raise SelectorError(f"{document.slug} has no anchor {anchor!r}")
    if note_id is not None:
        note = session.get(Note, note_id)
        if note is None or note.document_id != document.id:
            raise SelectorError(f"note {note_id} does not belong to {document.slug}")
    record = check_human_body(session, document.id, kind, body, skills_dir=skills_dir)
    artifact = artifacts.human_version(
        None, body, document_id=document.id, kind=kind, anchor=anchor, note_id=note_id, gates=record
    )
    artifact = artifacts.insert(session, artifact)
    orchestrator.on_review(session, artifact)
    return artifact


def review(
    session: Session,
    artifact: Artifact,
    action: ReviewAction,
    *,
    body: dict[str, Any] | None = None,
    skills_dir: Path | None = None,
) -> Artifact:
    """Apply a review action; returns the artifact that now represents the scope."""
    if action == "reject":
        rejected = artifacts.set_review(session, artifact, Review.REJECTED)
        orchestrator.on_review(session, rejected)  # e.g. withdraw rejected concept links
        return rejected
    if action == "approve":
        if artifact.review is Review.REJECTED and artifact.origin is Origin.SKILL:
            live = artifacts.find_live(
                session, artifact.type, artifact.input_hash, artifact.skill_version
            )
            if live is not None:
                raise artifacts.ArtifactExistsError(live)
        approved = artifacts.set_review(session, artifact, Review.APPROVED)
        orchestrator.on_review(session, approved)
        return approved
    if body is None:
        raise OutputError(["edit needs a body"])
    record = check_human_body(
        session, artifact.document_id, artifact.type, body, skills_dir=skills_dir
    )
    edited = artifacts.human_version(
        artifact,
        body,
        document_id=artifact.document_id,
        kind=artifact.type,
        anchor=artifact.anchor,
        gates=record,
    )
    edited = artifacts.insert(session, edited)
    orchestrator.on_review(session, edited)
    return edited

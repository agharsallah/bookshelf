"""What a `narrate` job voices: a `Source`, the one shape the rest of the audio code needs.

    script   an `audio_summary` artifact (skills/write-audio-summary): payload `artifact_id`
    reading  a chapter (or part, or section) read aloud as written (`app.audio.reading`):
             payload `anchor`

Both come down to a script body, the language it is in, where its renders live on disk
(`store` folder) and what the audio says it is, so one job body, one store and one player
serve them all. A new kind of narration is one more resolver here.
"""

import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from sqlmodel import Session

from app.audio import reading
from app.audio.speech import Kind
from app.core.errors import NotFoundError
from app.models import Artifact, Document, Job
from app.models.enums import ArtifactType
from app.pipeline.skills import ParamValue, Skill, skill_for_artifact_type
from app.services import tree

READING_PREFIX = "read~"
# A reading is one container's blocks; a whole book's worth is far past any chapter.
READING_CAP = 20_000


class SourceError(LookupError):
    """Nothing to voice: no such script, or no such chapter in this document."""


@dataclass(frozen=True, slots=True)
class Source:
    document: Document
    kind: Kind
    folder: str  # under the document's audio folder (`store.folder`)
    title: str  # what the disclosure names: the book
    body: Mapping[str, Any]  # `{title, speakers, sections}`
    language: str
    content: str = ""  # the words' hash, when they can change under the same folder
    artifact_id: uuid.UUID | None = None  # a script's
    anchor: str | None = None  # a reading's


def script_params(catalogue: Mapping[str, Skill], artifact: Artifact) -> dict[str, ParamValue]:
    """The params a script was written with, from its episode key (human edits keep it)."""
    skill = skill_for_artifact_type(catalogue, artifact.type)
    return (skill.meta.params_of(artifact.variant) if skill is not None else None) or {}


def reading_folder(anchor: str) -> str:
    """`ch01/s02` → `read~ch01~s02`: one folder per passage, named by its stable anchor."""
    return READING_PREFIX + anchor.replace("/", "~")


def script_source(
    session: Session, artifact_id: uuid.UUID, catalogue: Mapping[str, Skill]
) -> Source:
    artifact = session.get(Artifact, artifact_id)
    if artifact is None or artifact.type is not ArtifactType.AUDIO_SUMMARY:
        raise SourceError(f"artifact {artifact_id} is not an audio summary")
    document = session.get(Document, artifact.document_id)
    if document is None:  # pragma: no cover - the artifact cascades with its document
        raise SourceError("the script's document is gone")
    return Source(
        document=document,
        kind="summary",
        folder=str(artifact.id),
        title=document.title,
        body=artifact.body,
        language=str(script_params(catalogue, artifact).get("language", "en")),
        artifact_id=artifact.id,
    )


def reading_source(session: Session, document: Document, anchor: str) -> Source:
    try:
        node = tree.get_node(session, document.id, anchor)
    except NotFoundError as exc:
        raise SourceError(str(exc)) from exc
    if not node.kind.is_container:
        raise SourceError(f"{anchor!r} is a passage, not a chapter or section")
    unit, _ = tree.load_subtree(session, node, cap=READING_CAP)
    body = reading.chapter_script(unit)
    return Source(
        document=document,
        kind="reading",
        folder=reading_folder(anchor),
        title=document.title,
        body=body,
        language=document.language,
        content=reading.content_hash(body),
        anchor=anchor,
    )


def job_source(session: Session, job: Job, catalogue: Mapping[str, Skill]) -> Source:
    """The source a narrate job's payload names; `SourceError` when there is none."""
    payload = job.payload or {}
    if payload.get("anchor"):
        document = session.get(Document, job.document_id) if job.document_id else None
        if document is None:
            raise SourceError("a reading needs the job's document")
        return reading_source(session, document, str(payload["anchor"]))
    try:
        artifact_id = uuid.UUID(str(payload.get("artifact_id")))
    except ValueError:
        raise SourceError(f"narrate needs a script, got {payload.get('artifact_id')!r}") from None
    return script_source(session, artifact_id, catalogue)

"""Which cast voices what: `narrate` job specs, shared by `POST /jobs` and the orchestrator
(a stored `audio_summary` queues its narration with the cast it was asked for).

A narrate job's scope is one source (`app.audio.sources`) and one cast (`payload.voices`,
speaker 1 first): a script (`payload.artifact_id`) or a chapter read aloud (`payload.anchor`,
one reader). Its queue key says both, so asking twice for the same cast while one runs is
one job, and a different cast is a second.
"""

import uuid
from collections.abc import Mapping, Sequence
from pathlib import Path

from sqlmodel import Session

from app.audio import voices as voice_catalogue
from app.audio.sources import SourceError, reading_source, script_params
from app.audio.speech import FORMAT_SPEAKERS, default_cast, default_voices, speaker_count
from app.jobs.queue import JobSpec
from app.models import Artifact, Document
from app.models.enums import ArtifactType, JobKind
from app.pipeline.skills import ParamValue, Skill
from app.services.errors import InvalidInputError

NARRATE_PRIORITY = 130  # after everything that feeds study material


def check_voices(voices_dir: Path, voices: Sequence[str], *, count: int) -> list[str]:
    """`voices` if there is one known voice per speaker; else `InvalidInputError`."""
    if len(voices) != count:
        raise InvalidInputError(
            f"This script has {count} speaker{'s' if count != 1 else ''}; "
            f"give {count} voice{'s' if count != 1 else ''}, got {len(voices)}.",
            field="body.voices",
        )
    known = {voice.id for voice in voice_catalogue.catalogue(voices_dir)}
    unknown = [voice for voice in voices if voice not in known]
    if unknown:
        raise InvalidInputError(f"No voice called {unknown[0]!r}.", field="body.voices")
    return list(voices)


def cast_for(
    voices_dir: Path, voices: Sequence[str] | None, params: Mapping[str, ParamValue]
) -> list[str]:
    """The cast for a new episode with `params`: `voices` checked, or the default one."""
    format_ = str(params.get("format", "conversation"))
    count = FORMAT_SPEAKERS.get(format_, 2)
    if voices is None:
        return default_voices(format_, str(params.get("language", "en")))
    return check_voices(voices_dir, voices, count=count)


def narrate_spec(artifact: Artifact, voices: Sequence[str], *, force: bool = False) -> JobSpec:
    payload: dict[str, object] = {"artifact_id": str(artifact.id), "voices": list(voices)}
    if force:
        payload["force"] = True
    return JobSpec(
        kind=JobKind.NARRATE,
        document_id=artifact.document_id,
        input_hash=f"narrate:{artifact.id}:{'+'.join(voices)}",
        payload=payload,
        priority=NARRATE_PRIORITY,
    )


def reading_spec(
    document: Document, anchor: str, voices: Sequence[str], *, force: bool = False
) -> JobSpec:
    payload: dict[str, object] = {"anchor": anchor, "voices": list(voices)}
    if force:
        payload["force"] = True
    return JobSpec(
        kind=JobKind.NARRATE,
        document_id=document.id,
        anchor=anchor,
        input_hash=f"narrate:read:{anchor}:{'+'.join(voices)}",
        payload=payload,
        priority=NARRATE_PRIORITY,
    )


def requested_reading(
    session: Session,
    *,
    document_id: uuid.UUID | None,
    anchor: str,
    voices: Sequence[str] | None,
    voices_dir: Path,
    force: bool = False,
) -> JobSpec:
    """`POST /jobs {kind: narrate, anchor}`: read one chapter (or section) aloud, one voice."""
    document = session.get(Document, document_id) if document_id is not None else None
    if document is None:
        raise InvalidInputError("Reading aloud needs a `document_id`.", field="body.document_id")
    try:
        source = reading_source(session, document, anchor)
    except SourceError as exc:
        raise InvalidInputError(str(exc), field="body.anchor") from exc
    if not source.body["sections"]:
        raise InvalidInputError(f"{anchor!r} has no text to read aloud.", field="body.anchor")
    if voices is None:
        cast = default_cast(1, document.language)
    else:
        cast = check_voices(voices_dir, voices, count=1)
    return reading_spec(document, anchor, cast, force=force)


def requested_spec(
    session: Session,
    *,
    document_id: uuid.UUID | None,
    artifact_id: uuid.UUID | None,
    voices: Sequence[str] | None,
    catalogue: Mapping[str, Skill],
    voices_dir: Path,
    anchor: str | None = None,
    force: bool = False,
) -> JobSpec:
    """A manual `POST /jobs {kind: narrate}`: voice (again) one script of this document, or,
    with an `anchor` and no script, read that chapter aloud."""
    if artifact_id is None and anchor:
        return requested_reading(
            session,
            document_id=document_id,
            anchor=anchor,
            voices=voices,
            voices_dir=voices_dir,
            force=force,
        )
    if artifact_id is None:
        raise InvalidInputError(
            "`narrate` jobs need an `artifact_id` (a script) or an `anchor` (a chapter).",
            field="body.artifact_id",
        )
    artifact = session.get(Artifact, artifact_id)
    if (
        artifact is None
        or artifact.document_id != document_id
        or artifact.type is not ArtifactType.AUDIO_SUMMARY
    ):
        raise InvalidInputError(
            f"Artifact {artifact_id} is not an audio summary of this document.",
            field="body.artifact_id",
        )
    count = speaker_count(artifact.body)
    if voices is None:
        language = str(script_params(catalogue, artifact).get("language", "en"))
        cast = default_cast(count, language)
    else:
        cast = check_voices(voices_dir, voices, count=count)
    return narrate_spec(artifact, cast, force=force)

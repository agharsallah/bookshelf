"""Which cast voices which script: `narrate` job specs, shared by `POST /jobs` and the
orchestrator (a stored `audio_summary` queues its narration with the cast it was asked for).

A narrate job's scope is one script (`payload.artifact_id`) and one cast (`payload.voices`,
speaker 1 first); its queue key says both, so asking twice for the same cast while one runs
is one job, and a different cast is a second.
"""

import uuid
from collections.abc import Mapping, Sequence
from pathlib import Path

from sqlmodel import Session

from app.audio import voices as voice_catalogue
from app.audio.speech import FORMAT_SPEAKERS, default_cast, default_voices, speaker_count
from app.jobs.queue import JobSpec
from app.models import Artifact
from app.models.enums import ArtifactType, JobKind
from app.pipeline.skills import ParamValue, Skill, skill_for_artifact_type
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


def script_params(catalogue: Mapping[str, Skill], artifact: Artifact) -> dict[str, ParamValue]:
    """The params a script was written with, from its episode key (human edits keep it)."""
    skill = skill_for_artifact_type(catalogue, artifact.type)
    return (skill.meta.params_of(artifact.variant) if skill is not None else None) or {}


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


def requested_spec(
    session: Session,
    *,
    document_id: uuid.UUID | None,
    artifact_id: uuid.UUID | None,
    voices: Sequence[str] | None,
    catalogue: Mapping[str, Skill],
    voices_dir: Path,
    force: bool = False,
) -> JobSpec:
    """A manual `POST /jobs {kind: narrate}`: voice (again) one script of this document."""
    if artifact_id is None:
        raise InvalidInputError("`narrate` jobs need an `artifact_id`.", field="body.artifact_id")
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

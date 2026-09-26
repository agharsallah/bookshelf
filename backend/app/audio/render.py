"""The `narrate` job body: voice one `audio_summary` script with one cast.

    payload: {artifact_id, voices: [voice id, speaker 1 first], force?}

The render key hashes the cast and the engine settings, so an unchanged request is a free
skip (unless `force`) and a new cast or model makes a second render beside the first. The
database transaction is released for the whole synthesis, which can take a long time.
"""

import logging
import uuid
from pathlib import Path

import httpx
from sqlmodel import Session

from app.audio import store
from app.audio import voices as voice_catalogue
from app.audio.narration import script_params
from app.audio.runner import SpeechError, SpeechRunner
from app.audio.speech import ScriptError, build_request, speaker_count
from app.core.config import Settings, get_settings
from app.db.session import release
from app.jobs.registry import HandlerResult, PermanentJobError
from app.models import Artifact, Document, Job
from app.models.enums import ArtifactType, JobState
from app.pipeline.skills import load_catalogue

logger = logging.getLogger(__name__)


def _script(session: Session, job: Job) -> Artifact:
    raw = job.payload.get("artifact_id")
    try:
        artifact = session.get(Artifact, uuid.UUID(str(raw)))
    except ValueError:
        artifact = None
    if artifact is None or artifact.type is not ArtifactType.AUDIO_SUMMARY:
        raise PermanentJobError(f"narrate needs an audio_summary artifact, got {raw!r}")
    return artifact


def _cast(job: Job, voices_dir: Path, artifact: Artifact) -> list[voice_catalogue.Voice]:
    ids = job.payload.get("voices")
    if not isinstance(ids, list) or len(ids) != speaker_count(artifact.body):
        raise PermanentJobError(
            f"the script has {speaker_count(artifact.body)} speakers; payload.voices is {ids!r}"
        )
    cast = [voice_catalogue.find(voices_dir, str(voice_id)) for voice_id in ids]
    missing = [voice_id for voice_id, voice in zip(ids, cast, strict=True) if voice is None]
    if missing:
        raise PermanentJobError(f"unknown voice {missing[0]!r}")
    return [voice for voice in cast if voice is not None]


def narrate(
    session: Session, job: Job, *, runner: SpeechRunner, settings: Settings | None = None
) -> HandlerResult:
    settings = settings or get_settings()
    artifact = _script(session, job)
    document = session.get(Document, artifact.document_id)
    if document is None:  # pragma: no cover - the artifact cascades with its document
        raise PermanentJobError("the script's document is gone")
    cast = _cast(job, settings.voices_dir, artifact)
    voice_ids = tuple(voice.id for voice in cast)
    key = store.render_key(voice_ids, runner.engine())
    existing = store.find(settings.audio_dir, document.id, artifact.id, key)
    if existing is not None and not job.payload.get("force"):
        return HandlerResult(
            state=JobState.SKIPPED,
            result={"reason": "already narrated", "render": key, "file": existing.file},
        )

    language = str(
        script_params(load_catalogue(settings.skills_dir), artifact).get("language", "en")
    )
    try:
        samples = [voice_catalogue.sample_path(settings.voices_dir, voice) for voice in cast]
        request = build_request(artifact.body, samples, title=document.title, language=language)
    except ScriptError as exc:
        raise PermanentJobError(f"cannot narrate this script: {exc}") from exc
    except httpx.HTTPError as exc:  # transient: the voice sample download; the queue retries
        raise SpeechError(f"could not fetch a voice sample: {exc}") from exc

    release(session)  # no transaction open through a long synthesis
    out = store.audio_path(settings.audio_dir, document.id, artifact.id, key)
    result = runner.synthesize(request, out)
    render = store.save(
        settings.audio_dir,
        store.Render(
            key=key,
            document_id=str(document.id),
            artifact_id=str(artifact.id),
            voices=voice_ids,
            duration=result.duration,
            sections=result.sections,
            turns=result.turns,
            engine={**runner.engine(), **result.engine},
        ),
    )
    logger.info(
        "Narration stored",
        extra={"artifact_id": str(artifact.id), "render": key, "duration": render.duration},
    )
    return HandlerResult(
        result={
            "artifact_id": str(artifact.id),
            "render": key,
            "file": render.file,
            "duration": round(render.duration, 1),
            "voices": list(voice_ids),
        }
    )

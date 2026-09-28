"""The `narrate` job body: voice one source (`app.audio.sources`) with one cast.

    payload: {artifact_id | anchor, voices: [voice id, speaker 1 first], force?}

The render key hashes the cast, the engine settings and (for a chapter, whose words change
when it is parsed again) the words, so an unchanged request is a free skip (unless `force`)
and a new cast, model or text makes a second render beside the first. The database
transaction is released for the whole synthesis, which can take a long time.
"""

import logging
from pathlib import Path

import httpx
from sqlmodel import Session

from app.audio import store
from app.audio import voices as voice_catalogue
from app.audio.runner import SpeechError, SpeechRunner
from app.audio.sources import Source, SourceError, job_source
from app.audio.speech import ScriptError, build_request, speaker_count
from app.core.config import Settings, get_settings
from app.db.session import release
from app.jobs.registry import HandlerResult, PermanentJobError
from app.models import Job
from app.models.enums import JobState
from app.pipeline.skills import load_catalogue

logger = logging.getLogger(__name__)


def _cast(job: Job, voices_dir: Path, source: Source) -> list[voice_catalogue.Voice]:
    ids = job.payload.get("voices")
    count = speaker_count(source.body)
    if not isinstance(ids, list) or len(ids) != count:
        raise PermanentJobError(f"the script has {count} speakers; payload.voices is {ids!r}")
    cast = [voice_catalogue.find(voices_dir, str(voice_id)) for voice_id in ids]
    missing = [voice_id for voice_id, voice in zip(ids, cast, strict=True) if voice is None]
    if missing:
        raise PermanentJobError(f"unknown voice {missing[0]!r}")
    return [voice for voice in cast if voice is not None]


def narrate(
    session: Session, job: Job, *, runner: SpeechRunner, settings: Settings | None = None
) -> HandlerResult:
    settings = settings or get_settings()
    try:
        source = job_source(session, job, load_catalogue(settings.skills_dir))
    except SourceError as exc:
        raise PermanentJobError(f"nothing to narrate: {exc}") from exc
    document = source.document
    cast = _cast(job, settings.voices_dir, source)
    voice_ids = tuple(voice.id for voice in cast)
    key = store.render_key(voice_ids, runner.engine(), source.content)
    existing = store.find(settings.audio_dir, document.id, source.folder, key)
    if existing is not None and not job.payload.get("force"):
        return HandlerResult(
            state=JobState.SKIPPED,
            result={"reason": "already narrated", "render": key, "file": existing.file},
        )

    try:
        samples = [voice_catalogue.sample_path(settings.voices_dir, voice) for voice in cast]
        request = build_request(
            source.body, samples, title=source.title, language=source.language, kind=source.kind
        )
    except ScriptError as exc:
        raise PermanentJobError(f"cannot narrate this script: {exc}") from exc
    except httpx.HTTPError as exc:  # transient: the voice sample download; the queue retries
        raise SpeechError(f"could not fetch a voice sample: {exc}") from exc

    release(session)  # no transaction open through a long synthesis
    out = store.audio_path(settings.audio_dir, document.id, source.folder, key)
    result = runner.synthesize(request, out)
    render = store.save(
        settings.audio_dir,
        store.Render(
            key=key,
            document_id=str(document.id),
            source=source.folder,
            voices=voice_ids,
            duration=result.duration,
            sections=result.sections,
            turns=result.turns,
            engine={**runner.engine(), **result.engine},
            content=source.content,
        ),
    )
    logger.info(
        "Narration stored",
        extra={"source": source.folder, "render": key, "duration": render.duration},
    )
    what = {"artifact_id": str(source.artifact_id)} if source.artifact_id else {}
    what |= {"anchor": source.anchor} if source.anchor else {}
    return HandlerResult(
        result={
            **what,
            "render": key,
            "file": render.file,
            "duration": round(render.duration, 1),
            "voices": list(voice_ids),
        }
    )

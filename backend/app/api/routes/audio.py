"""Audio summaries: voices to cast, a book's episodes, and the narrations themselves.

Making an episode is a job like any other study material: `POST /jobs` with
`{kind: derive, skill: write-audio-summary, params, voices}` writes the script, then its
narration queues itself; `{kind: narrate, artifact_id, voices}` voices a script again.
"""

import re
from typing import Annotated

import httpx
from fastapi import APIRouter, Query
from fastapi import Path as PathParam
from fastapi.responses import FileResponse

from app.api.deps import SessionDep, SettingsDep
from app.api.pipeline import SkillsDirDep
from app.audio import episodes, store
from app.audio import voices as voice_catalogue
from app.audio.speech import DEFAULT_VOICES, FORMAT_SPEAKERS
from app.core.errors import NotFoundError
from app.pipeline.skills import load_catalogue
from app.schemas.audio import AudioShelf, VoiceCatalogue, VoicePublic
from app.services import documents
from app.services.errors import UpstreamError

router = APIRouter(tags=["audio"])

# Audio is derived and keyed by content (a new render gets a new name): cache it for good.
AUDIO_HEADERS = {
    "Cache-Control": "public, max-age=31536000, immutable",
    "Cross-Origin-Resource-Policy": "cross-origin",
}
_FILENAME = re.compile(r"[^A-Za-z0-9._ -]+")


def _voice(voice: voice_catalogue.Voice) -> VoicePublic:
    return VoicePublic(
        id=voice.id,
        name=voice.name,
        gender=voice.gender,
        accent=voice.accent,
        languages=list(voice.languages),
        with_music=voice.with_music,
        custom=voice.custom,
        sample_url=f"audio/voices/{voice.id}/sample",
    )


@router.get(
    "/audio/voices",
    response_model=VoiceCatalogue,
    summary="Voices to cast, speakers per format, default casts",
    description="Built-in VibeVoice voices first, then your own recordings "
    "(`.wav` files in `BOOKSHELF_VOICES_DIR/custom`).",
)
def list_voices(settings: SettingsDep) -> VoiceCatalogue:
    return VoiceCatalogue(
        voices=[_voice(v) for v in voice_catalogue.catalogue(settings.voices_dir)],
        speakers=dict(FORMAT_SPEAKERS),
        defaults={language: list(cast) for language, cast in DEFAULT_VOICES.items()},
    )


@router.get(
    "/audio/voices/{voice_id}/sample",
    response_class=FileResponse,
    responses={200: {"content": {"audio/wav": {}}}},
    summary="Hear a voice: its reference clip",
)
def voice_sample(
    voice_id: Annotated[str, PathParam(max_length=80)], settings: SettingsDep
) -> FileResponse:
    voice = voice_catalogue.find(settings.voices_dir, voice_id)
    if voice is None:
        raise NotFoundError(f"No voice called {voice_id!r}.")
    try:
        path = voice_catalogue.sample_path(settings.voices_dir, voice)
    except httpx.HTTPError as exc:
        raise UpstreamError(f"The voice sample could not be downloaded: {exc}") from exc
    return FileResponse(path, media_type="audio/wav", headers=AUDIO_HEADERS)


@router.get(
    "/documents/{ref}/audio",
    response_model=AudioShelf,
    summary="A book's audio summaries: episodes, scripts and narrations",
)
def document_audio(
    ref: Annotated[str, PathParam(min_length=1, max_length=200)],
    session: SessionDep,
    settings: SettingsDep,
    skills_dir: SkillsDirDep,
) -> AudioShelf:
    document = documents.get_document(session, ref)
    return episodes.shelf(session, document, load_catalogue(skills_dir), settings.audio_dir)


@router.get(
    "/audio/files/{path:path}",
    response_class=FileResponse,
    responses={200: {"content": {"audio/mpeg": {}}}, 206: {"description": "A byte range."}},
    summary="Stream or download a narration (byte ranges supported)",
)
def audio_file(
    path: Annotated[str, PathParam(max_length=512)],
    settings: SettingsDep,
    download: Annotated[
        str | None,
        Query(max_length=150, description="Save as this file name instead of playing."),
    ] = None,
) -> FileResponse:
    file, media_type = store.resolve_file(settings.audio_dir, path)
    name = _FILENAME.sub("", download or "").strip()
    if download is not None and not name.lower().endswith(".mp3"):
        name = f"{name or 'audio-summary'}.mp3"
    return FileResponse(
        file,
        media_type=media_type,
        headers=AUDIO_HEADERS,
        filename=name or None,
        content_disposition_type="attachment",
    )

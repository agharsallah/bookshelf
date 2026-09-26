"""Wire shapes for audio summaries: the voice catalogue and a book's episodes."""

import uuid
from datetime import datetime
from typing import Annotated, Any

from pydantic import BaseModel, Field

from app.models.enums import Origin, Review


class VoicePublic(BaseModel):
    id: str
    name: str
    gender: str
    accent: str
    languages: list[str]
    with_music: Annotated[bool, Field(description="Narrates over the clip's music bed.")]
    custom: Annotated[bool, Field(description="Your own recording (`voices_dir/custom`).")]
    sample_url: Annotated[str, Field(description="The reference clip, to hear the voice.")]


class VoiceCatalogue(BaseModel):
    voices: list[VoicePublic]
    speakers: Annotated[dict[str, int], Field(description="Speakers per episode format.")]
    defaults: Annotated[
        dict[str, list[str]], Field(description="Per language, the default cast in order.")
    ]


class Mark(BaseModel):
    start: float
    end: float
    section: int
    turn: int | None = None
    title: str | None = None


class AudioRender(BaseModel):
    """One voicing of a script: the MP3 and its timeline."""

    key: str
    voices: list[str]
    duration: Annotated[float, Field(description="Seconds.")]
    sections: list[Mark]
    turns: Annotated[list[Mark], Field(description="Where each turn starts, estimated.")]
    url: Annotated[str, Field(description="The MP3, relative to the API prefix.")]
    engine: dict[str, Any]
    created_at: str


class AudioScript(BaseModel):
    id: uuid.UUID
    version: int
    origin: Origin
    review: Review
    body: Annotated[dict[str, Any], Field(description="`{title, speakers, sections}`.")]
    gates: dict[str, Any]
    created_at: datetime


class AudioEpisode(BaseModel):
    """One episode of a book: a length, format and language, its script and renders."""

    variant: str
    params: dict[str, str | int]
    script: AudioScript
    renders: Annotated[list[AudioRender], Field(description="Newest first.")]


class AudioShelf(BaseModel):
    document_id: uuid.UUID
    episodes: Annotated[list[AudioEpisode], Field(description="Shortest first, then format.")]

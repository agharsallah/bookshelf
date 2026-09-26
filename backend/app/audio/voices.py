"""Voices a narration can use: VibeVoice's published samples, plus your own recordings.

VibeVoice clones a voice from a short reference clip, one per speaker. The built-in voices
are the samples published with the model (`bezzam/vibevoice_samples` on Hugging Face),
downloaded on first use into `settings.voices_dir`. Your own voices are `.wav` files you
put in `settings.voices_dir / "custom"` (10 to 60 s of clean speech); the file name becomes
the voice's name. Record only voices whose owners agreed to it (the model card forbids
impersonation).

`with_music`: VibeVoice carries a reference clip's background over into what it says, so
a voice recorded over music narrates over a music bed, the model's own way of scoring.
"""

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import httpx

from app.core.errors import NotFoundError

SAMPLES_URL = "https://huggingface.co/datasets/bezzam/vibevoice_samples/resolve/main/voices/"
CUSTOM = "custom"
_ID = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
_DOWNLOAD_TIMEOUT = 60.0

Gender = Literal["woman", "man", "unknown"]


@dataclass(frozen=True, slots=True)
class Voice:
    id: str
    name: str
    gender: Gender
    accent: str  # what a listener hears, e.g. "American English"
    languages: tuple[str, ...]  # script languages it reads well (`en`, `zh`)
    with_music: bool = False
    custom: bool = False
    file: str = ""  # built-in: the sample's file name upstream; custom: under `custom/`


BUILTIN: tuple[Voice, ...] = (
    Voice("alice", "Alice", "woman", "American English", ("en",), file="en-Alice_woman.wav"),
    Voice("carter", "Carter", "man", "American English", ("en",), file="en-Carter_man.wav"),
    Voice("frank", "Frank", "man", "American English", ("en",), file="en-Frank_man.wav"),
    Voice("maya", "Maya", "woman", "American English", ("en",), file="en-Maya_woman.wav"),
    Voice(
        "mary", "Mary", "woman", "English, over music", ("en",), True, file="en-Mary_woman_bgm.wav"
    ),
    Voice("samuel", "Samuel", "man", "Indian English", ("en",), file="in-Samuel_man.wav"),
    Voice("xinran", "Xinran", "woman", "Mandarin", ("zh", "en"), file="zh-Xinran_woman.wav"),
    Voice("bowen", "Bowen", "man", "Mandarin", ("zh", "en"), file="zh-Bowen_man.wav"),
    Voice(
        "anchen",
        "Anchen",
        "man",
        "Mandarin, over music",
        ("zh", "en"),
        True,
        file="zh-Anchen_man_bgm.wav",
    ),
)


def _custom_id(stem: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", stem.lower()).strip("-")
    return f"{CUSTOM}-{slug}" if slug else ""


def catalogue(voices_dir: Path) -> list[Voice]:
    """Built-in voices, then your own (`voices_dir/custom/*.wav`), by name."""
    custom: list[Voice] = []
    folder = voices_dir / CUSTOM
    if folder.is_dir():
        for path in sorted(folder.glob("*.wav"), key=lambda p: p.stem.lower()):
            voice_id = _custom_id(path.stem)
            if voice_id and _ID.match(voice_id):
                name = path.stem.replace("_", " ").replace("-", " ").strip().title()
                custom.append(
                    Voice(
                        voice_id,
                        name,
                        "unknown",
                        "your recording",
                        ("en", "zh"),
                        custom=True,
                        file=path.name,
                    )
                )
    return [*BUILTIN, *custom]


def find(voices_dir: Path, voice_id: str) -> Voice | None:
    return next((v for v in catalogue(voices_dir) if v.id == voice_id), None)


def sample_path(voices_dir: Path, voice: Voice, *, client: httpx.Client | None = None) -> Path:
    """The voice's reference clip on disk, downloading a built-in one the first time."""
    if voice.custom:
        path = voices_dir / CUSTOM / voice.file
        if not path.is_file():
            raise NotFoundError(f"Voice {voice.id} has no recording any more.")
        return path
    path = voices_dir / voice.file
    if path.is_file():
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_suffix(".part")
    http = client or httpx.Client(timeout=_DOWNLOAD_TIMEOUT, follow_redirects=True)
    try:
        response = http.get(SAMPLES_URL + voice.file)
        response.raise_for_status()
        partial.write_bytes(response.content)
    finally:
        if client is None:
            http.close()
    partial.replace(path)  # atomic: a half download never passes for a sample
    return path

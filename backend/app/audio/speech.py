"""From a script to what the speech model reads.

A script is sections of turns, each turn a speaker number (1 to 4) and what they say, with
cites: an `audio_summary` (skills/write-audio-summary) or a chapter read aloud
(`app.audio.reading`, one reader). The speech model needs only the words and one
reference clip per speaker, so this strips the cites, tidies the text for speaking, and
opens with a short spoken note that the audio is AI-generated (VibeVoice's terms ask that
synthetic speech say so).
"""

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

# How many people each format has; the script declares exactly this many speakers.
FORMAT_SPEAKERS: Mapping[str, int] = {"narrator": 1, "conversation": 2, "panel": 3, "roundtable": 4}
# Voices a new episode starts with, per language, taken in order (one per speaker).
DEFAULT_VOICES: Mapping[str, tuple[str, ...]] = {
    "en": ("alice", "frank", "maya", "carter"),
    "zh": ("xinran", "bowen", "anchen", "alice"),
}
# What the audio is, said first: a summary written about the book, or its own words read.
Kind = Literal["summary", "reading"]
DISCLOSURE: Mapping[Kind, Mapping[str, str]] = {
    "summary": {
        "en": "This is an AI-generated audio summary of {title}.",
        "zh": "这是一段由人工智能生成的《{title}》音频摘要。",
    },
    "reading": {
        "en": "This is an AI-generated reading of {title}.",
        "zh": "这是一段由人工智能朗读的《{title}》。",
    },
}

_MARKUP = re.compile(r"[*_`#>]+")
_SPACE = re.compile(r"\s+")


class ScriptError(ValueError):
    """A body that is not a speakable script, or voices that do not fit it."""


@dataclass(frozen=True, slots=True)
class Turn:
    speaker: int  # 0-based index into the request's voices
    text: str


@dataclass(frozen=True, slots=True)
class Section:
    title: str
    turns: tuple[Turn, ...]


@dataclass(frozen=True, slots=True)
class SpeechRequest:
    """Everything one narration needs. `voices[i]` is the reference clip of speaker i+1."""

    title: str
    voices: tuple[Path, ...]
    sections: tuple[Section, ...]

    def as_json(self) -> dict[str, Any]:
        return {
            "title": self.title,
            "voices": [str(v) for v in self.voices],
            "sections": [
                {
                    "title": s.title,
                    "turns": [{"speaker": t.speaker, "text": t.text} for t in s.turns],
                }
                for s in self.sections
            ],
        }


def default_cast(count: int, language: str) -> list[str]:
    """The first `count` default voices for `language` (English when unknown)."""
    return list(DEFAULT_VOICES.get(language, DEFAULT_VOICES["en"])[:count])


def default_voices(format_: str, language: str) -> list[str]:
    return default_cast(FORMAT_SPEAKERS.get(format_, 2), language)


def speakable(text: str) -> str:
    """Markdown emphasis and stray symbols read aloud badly; runs of space collapse."""
    return _SPACE.sub(" ", _MARKUP.sub("", text)).strip()


def speaker_count(body: Mapping[str, Any]) -> int:
    speakers = body.get("speakers")
    return len(speakers) if isinstance(speakers, list) else 0


def build_request(
    body: Mapping[str, Any],
    voices: Sequence[Path],
    *,
    title: str,
    language: str = "en",
    kind: Kind = "summary",
) -> SpeechRequest:
    """The request for one script and its voices (one per declared speaker, in order)."""
    count = speaker_count(body)
    if count == 0:
        raise ScriptError("the script declares no speakers")
    if len(voices) != count:
        raise ScriptError(f"the script has {count} speakers but {len(voices)} voices were given")
    sections: list[Section] = []
    for raw in body.get("sections") or []:
        turns = tuple(
            Turn(speaker=int(turn["speaker"]) - 1, text=text)
            for turn in raw.get("turns") or []
            if (text := speakable(str(turn.get("text", ""))))
            and 1 <= int(turn.get("speaker", 0)) <= count
        )
        if turns:
            sections.append(Section(title=speakable(str(raw.get("title", ""))), turns=turns))
    if not sections:
        raise ScriptError("the script has nothing to say")
    first = sections[0]
    said = DISCLOSURE[kind]
    disclosure = said.get(language, said["en"]).format(title=title)
    opening = Turn(first.turns[0].speaker, f"{disclosure} {first.turns[0].text}")
    sections[0] = Section(first.title, (opening, *first.turns[1:]))
    return SpeechRequest(title=title, voices=tuple(voices), sections=tuple(sections))

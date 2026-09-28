"""Narrations on disk (D1: derived, disposable, rebuildable from the script).

    <audio_dir>/<document id>/<source>/<render key>.mp3   the audio
    <audio_dir>/<document id>/<source>/<render key>.json  its manifest

A source is what was voiced (`app.audio.sources`): an audio summary's script (its artifact
id) or a chapter read aloud (`read~<anchor>`). A render is one source voiced by one cast
with one engine setup, so its key hashes the voices, the engine settings and, for a source
whose words can change, their hash: voicing the same words again with the same cast is a
free skip, and a new cast is a second render beside the first. The manifest carries the
timeline (where each section and turn starts), so the player can show chapters and follow
the transcript. Folders are named by id, never slug, so renaming a book keeps its audio.
"""

import hashlib
import json
import re
import shutil
import uuid
from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.core.errors import NotFoundError

AUDIO_TYPES: Mapping[str, str] = {".mp3": "audio/mpeg"}
_SOURCE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._~-]{0,199}")


@dataclass(frozen=True, slots=True)
class Mark:
    """Where a section (or a turn: `section` + `turn`) starts and ends, in seconds."""

    start: float
    end: float
    section: int
    turn: int | None = None
    title: str | None = None


@dataclass(frozen=True, slots=True)
class Render:
    key: str
    document_id: str
    source: str  # the folder under the document: a script's artifact id, `read~<anchor>`
    voices: tuple[str, ...]  # voice ids, speaker 1 first
    duration: float
    sections: tuple[Mark, ...]
    turns: tuple[Mark, ...]
    engine: Mapping[str, Any] = field(default_factory=dict)
    created_at: str = ""
    content: str = ""  # the hash of the words voiced, for a source whose words can change

    @property
    def file(self) -> str:
        """The audio's path relative to `audio_dir`, as `/audio/files/` serves it."""
        return f"{self.document_id}/{self.source}/{self.key}.mp3"


def render_key(voices: Sequence[str], engine: Mapping[str, Any], content: str = "") -> str:
    fields: dict[str, Any] = {"voices": list(voices), "engine": engine}
    if content:  # scripts never had one, so their keys (and renders) stay as they were
        fields["content"] = content
    payload = json.dumps(fields, sort_keys=True)
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


def folder(audio_dir: Path, document_id: uuid.UUID, source: str) -> Path:
    if not _SOURCE.fullmatch(source):
        raise ValueError(f"not a narration source: {source!r}")
    return audio_dir / str(document_id) / source


def audio_path(audio_dir: Path, document_id: uuid.UUID, source: str, key: str) -> Path:
    return folder(audio_dir, document_id, source) / f"{key}.mp3"


def save(audio_dir: Path, render: Render) -> Render:
    """Write the manifest beside its audio (which must already be there)."""
    base = audio_dir / render.document_id / render.source
    if not (base / f"{render.key}.mp3").is_file():
        raise FileNotFoundError(f"no audio for render {render.key}")
    stamped = Render(**{**_fields(render), "created_at": datetime.now(UTC).isoformat()})
    manifest = base / f"{render.key}.json"
    partial = manifest.with_suffix(".part")
    partial.write_text(json.dumps(asdict(stamped), ensure_ascii=False, indent=1), "utf-8")
    partial.replace(manifest)
    return stamped


def _fields(render: Render) -> dict[str, Any]:
    return {name: getattr(render, name) for name in Render.__dataclass_fields__}


def _load(path: Path) -> Render | None:
    try:
        raw = json.loads(path.read_text("utf-8"))
        return Render(
            key=raw["key"],
            document_id=raw["document_id"],
            # Manifests written before chapters could be read aloud name their script.
            source=raw.get("source") or raw["artifact_id"],
            voices=tuple(raw["voices"]),
            duration=float(raw["duration"]),
            sections=tuple(Mark(**m) for m in raw["sections"]),
            turns=tuple(Mark(**m) for m in raw["turns"]),
            engine=raw.get("engine", {}),
            created_at=raw.get("created_at", ""),
            content=raw.get("content", ""),
        )
    except (OSError, ValueError, KeyError, TypeError):
        return None  # a torn or foreign file is not a render


def find(audio_dir: Path, document_id: uuid.UUID, source: str, key: str) -> Render | None:
    base = folder(audio_dir, document_id, source)
    render = _load(base / f"{key}.json")
    return render if render is not None and (base / f"{key}.mp3").is_file() else None


def list_renders(
    audio_dir: Path, document_id: uuid.UUID, source: str | None = None
) -> list[Render]:
    """Every complete render of a document's sources (or of one `source`), newest first."""
    root = audio_dir / str(document_id)
    if not root.is_dir():
        return []
    pattern = f"{folder(audio_dir, document_id, source).name}/*.json" if source else "*/*.json"
    found = [
        render
        for manifest in root.glob(pattern)
        if (render := _load(manifest)) is not None and manifest.with_suffix(".mp3").is_file()
    ]
    return sorted(found, key=lambda r: r.created_at, reverse=True)


def remove_document(audio_dir: Path, document_id: uuid.UUID) -> bool:
    """Delete a document's narrations (it was deleted). True when there were any."""
    root = (audio_dir / str(document_id)).resolve()
    if not root.is_relative_to(audio_dir.resolve()) or not root.is_dir():
        return False
    shutil.rmtree(root)
    return True


def resolve_file(audio_dir: Path, raw: str) -> tuple[Path, str]:
    """A narration strictly inside `audio_dir`, with its media type; else a plain 404
    (traversal, symlink escape, absolute path, other file types, missing)."""
    root = audio_dir.resolve()
    missing = NotFoundError("No such audio file.")
    if not raw or Path(raw).is_absolute() or "\x00" in raw:
        raise missing
    try:
        resolved = (root / raw).resolve(strict=True)
    except (OSError, RuntimeError):
        raise missing from None
    media_type = AUDIO_TYPES.get(resolved.suffix.lower())
    if not resolved.is_relative_to(root) or not resolved.is_file() or media_type is None:
        raise missing
    return resolved, media_type

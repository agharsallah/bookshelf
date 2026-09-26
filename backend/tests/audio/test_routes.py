"""The audio routes: the voice catalogue, a book's episodes, and serving the MP3s."""

import json
from dataclasses import asdict
from pathlib import Path
from urllib.parse import unquote

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.audio import store
from app.core.config import Settings, get_settings
from app.models import Artifact, Document
from app.models.enums import Review
from tests.audio.conftest import WAV, add_script
from tests.conftest import AUTH

API = "/api/v1"
MP3 = b"ID3" + bytes(range(64))


def narration(audio_dir: Path, script: Artifact, key: str, created_at: str = "") -> str:
    """A finished render of `script` on disk; returns its file path under `audio_dir`."""
    render = store.Render(
        key=key,
        document_id=str(script.document_id),
        artifact_id=str(script.id),
        voices=("alice", "frank"),
        duration=90.0,
        sections=(store.Mark(0.0, 90.0, 0, title="Stocks"),),
        turns=(),
        engine={"model": "fake"},
        created_at=created_at,
    )
    audio = audio_dir / render.file
    audio.parent.mkdir(parents=True, exist_ok=True)
    audio.write_bytes(MP3)
    audio.with_suffix(".json").write_text(json.dumps(asdict(render)))
    return render.file


# --- Voices ----------------------------------------------------------------------------


def test_voices_lists_builtins_and_recordings_with_speakers_and_default_casts(api: TestClient):
    catalogue = api.get(f"{API}/audio/voices").json()

    by_id = {v["id"]: v for v in catalogue["voices"]}
    assert catalogue["voices"][0]["id"] == "alice"
    assert by_id["custom-ben"] == {
        "id": "custom-ben",
        "name": "Ben",
        "gender": "unknown",
        "accent": "your recording",
        "languages": ["en", "zh"],
        "with_music": False,
        "custom": True,
        "sample_url": "audio/voices/custom-ben/sample",
    }
    assert by_id["mary"]["with_music"] is True
    assert catalogue["speakers"] == {"narrator": 1, "conversation": 2, "panel": 3, "roundtable": 4}
    assert catalogue["defaults"]["zh"] == ["xinran", "bowen", "anchen", "alice"]


def test_a_voice_sample_is_its_reference_clip(api: TestClient, settings: Settings):
    (settings.voices_dir / "en-Alice_woman.wav").write_bytes(b"RIFF-alice")  # cached builtin

    custom = api.get(f"{API}/audio/voices/custom-ben/sample")
    builtin = api.get(f"{API}/audio/voices/alice/sample")

    assert (custom.status_code, custom.content) == (200, WAV)
    assert custom.headers["content-type"] == "audio/wav"
    assert builtin.content == b"RIFF-alice"


def test_an_unknown_voice_has_no_sample(api: TestClient):
    assert api.get(f"{API}/audio/voices/nobody/sample").status_code == 404


# --- A book's episodes ------------------------------------------------------------------


def test_episodes_are_one_per_variant_shortest_first_with_their_renders_newest_first(
    api: TestClient, session: Session, book: Document, settings: Settings
):
    panel = add_script(session, book, "30m-panel-en")
    approved = add_script(session, book, "5m-conversation-en", review=Review.APPROVED)
    add_script(session, book, "5m-conversation-en", version=2)  # a newer draft: not preferred
    add_script(session, book, "15m-narrator-en", review=Review.REJECTED)
    old = narration(settings.audio_dir, approved, "old", "2026-09-01T00:00:00+00:00")
    new = narration(settings.audio_dir, approved, "new", "2026-09-20T00:00:00+00:00")

    shelf = api.get(f"{API}/documents/{book.slug}/audio").json()

    episodes = shelf["episodes"]
    assert shelf["document_id"] == str(book.id)
    assert [(e["variant"], e["script"]["id"]) for e in episodes] == [
        ("5m-conversation-en", str(approved.id)),
        ("30m-panel-en", str(panel.id)),
    ]
    assert episodes[0]["params"] == {"minutes": 5, "format": "conversation", "language": "en"}
    assert [r["url"] for r in episodes[0]["renders"]] == [
        f"audio/files/{new}",
        f"audio/files/{old}",
    ]
    assert episodes[0]["renders"][0]["sections"][0]["title"] == "Stocks"
    assert episodes[1]["renders"] == []


def test_a_new_version_keeps_the_old_ones_that_were_recorded(
    api: TestClient, session: Session, book: Document, settings: Settings
):
    """A forced re-write rejects the old row (one live artifact per input); its recording
    must stay reachable. Replaced versions with no recording are left out."""
    first = add_script(session, book, "5m-narrator-en", review=Review.REJECTED)
    add_script(session, book, "5m-narrator-en", version=2, review=Review.REJECTED)  # unrecorded
    current = add_script(session, book, "5m-narrator-en", version=3)
    kept = narration(settings.audio_dir, first, "v1", "2026-09-01T00:00:00+00:00")
    narration(settings.audio_dir, current, "v3", "2026-09-20T00:00:00+00:00")

    [episode] = api.get(f"{API}/documents/{book.slug}/audio").json()["episodes"]

    assert episode["script"]["id"] == str(current.id)
    assert [v["script"]["version"] for v in episode["versions"]] == [3, 1]
    assert [r["url"] for r in episode["versions"][1]["renders"]] == [f"audio/files/{kept}"]


def test_an_episode_whose_every_version_was_replaced_still_plays(
    api: TestClient, session: Session, book: Document, settings: Settings
):
    only = add_script(session, book, "30m-panel-en", review=Review.REJECTED)
    narration(settings.audio_dir, only, "k", "2026-09-01T00:00:00+00:00")

    [episode] = api.get(f"{API}/documents/{book.slug}/audio").json()["episodes"]

    assert episode["script"]["id"] == str(only.id)
    assert len(episode["renders"]) == 1


def test_a_book_without_episodes_has_an_empty_shelf_and_an_unknown_one_is_404(
    api: TestClient, book: Document
):
    assert api.get(f"{API}/documents/{book.id}/audio").json()["episodes"] == []
    assert api.get(f"{API}/documents/no-such-book/audio").status_code == 404


# --- The MP3s ----------------------------------------------------------------------------


@pytest.fixture
def mp3(session: Session, book: Document, settings: Settings) -> str:
    return narration(settings.audio_dir, add_script(session, book), "k1")


def test_a_narration_plays_inline_with_long_caching(api: TestClient, mp3: str):
    response = api.get(f"{API}/audio/files/{mp3}")

    assert (response.status_code, response.content) == (200, MP3)
    assert response.headers["content-type"] == "audio/mpeg"
    assert "immutable" in response.headers["cache-control"]
    assert "content-disposition" not in response.headers


def test_a_byte_range_is_a_partial_response(api: TestClient, mp3: str):
    response = api.get(f"{API}/audio/files/{mp3}", headers={"Range": "bytes=0-3"})

    assert response.status_code == 206
    assert response.content == MP3[:4]
    assert response.headers["content-range"] == f"bytes 0-3/{len(MP3)}"


def saved_as(disposition: str) -> tuple[str, str]:
    """`(type, filename)` of a Content-Disposition, plain or RFC 5987 (`filename*=utf-8''…`)."""
    kind, _, param = disposition.partition("; ")
    name, _, value = param.partition("=")
    if name == "filename*":
        return kind, unquote(value.split("''", 1)[1])
    return kind, value.strip('"')


@pytest.mark.parametrize(
    ("download", "filename"),
    [
        ("Thinking in Systems: 5 min", "Thinking in Systems 5 min.mp3"),
        ("episode.MP3", "episode.MP3"),
        ("", "audio-summary.mp3"),
    ],
)
def test_download_saves_under_a_safe_mp3_name(api: TestClient, mp3: str, download, filename):
    response = api.get(f"{API}/audio/files/{mp3}", params={"download": download})

    assert saved_as(response.headers["content-disposition"]) == ("attachment", filename)


@pytest.mark.parametrize("path", ["..%2Fsecret.mp3", "%2Fetc%2Fpasswd", "k1.json", "missing.mp3"])
def test_anything_but_a_narration_inside_the_audio_folder_is_404(
    api: TestClient, settings: Settings, mp3: str, path: str
):
    (settings.audio_dir.parent / "secret.mp3").write_bytes(MP3)
    (settings.audio_dir / "k1.json").write_text("{}")

    assert api.get(f"{API}/audio/files/{path}").status_code == 404


def test_deleting_a_book_deletes_its_narrations(
    client: TestClient, session: Session, book: Document
):
    audio_dir = get_settings().audio_dir  # the delete reads the app's own settings
    file = narration(audio_dir, add_script(session, book), "k1")

    response = client.delete(f"{API}/documents/{book.id}", headers=AUTH)

    assert response.status_code == 204
    assert not (audio_dir / file).exists()
    assert not (audio_dir / str(book.id)).exists()

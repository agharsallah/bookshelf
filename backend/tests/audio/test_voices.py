"""The voice catalogue: built-in VibeVoice samples (fetched once), then your own recordings."""

from pathlib import Path

import httpx
import pytest

from app.audio import voices
from app.core.config import Settings
from app.core.errors import NotFoundError
from tests.audio.conftest import WAV

SAMPLE = b"RIFF-sample-bytes"


def refuse(request: httpx.Request) -> httpx.Response:
    raise AssertionError(f"no download expected, got {request.url}")


def client(responder) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(responder))


def test_catalogue_lists_the_builtins_then_your_recordings_by_name(settings: Settings):
    (settings.voices_dir / "custom" / "notes.txt").write_text("not a voice")
    (settings.voices_dir / "custom" / "!!!.wav").write_bytes(WAV)  # no name left to slug

    catalogue = voices.catalogue(settings.voices_dir)

    # By name, whatever the case: "ben.wav" before "Cy_Twist.wav".
    by_name = ["custom-ada-lovelace", "custom-ben", "custom-cy-twist"]
    assert [v.id for v in catalogue] == [v.id for v in voices.BUILTIN] + by_name
    ada = voices.find(settings.voices_dir, "custom-ada-lovelace")
    assert ada is not None
    assert (ada.name, ada.custom, ada.file, ada.languages) == (
        "Ada Lovelace",
        True,
        "Ada Lovelace.wav",
        ("en", "zh"),
    )
    assert voices.find(settings.voices_dir, "custom-cy-twist").name == "Cy Twist"


def test_without_a_custom_folder_only_the_builtins_are_listed(tmp_path: Path):
    assert voices.catalogue(tmp_path) == list(voices.BUILTIN)
    assert voices.find(tmp_path, "custom-ben") is None


def test_a_recording_is_its_own_sample(settings: Settings):
    ben = voices.find(settings.voices_dir, "custom-ben")

    path = voices.sample_path(settings.voices_dir, ben, client=client(refuse))

    assert path == settings.voices_dir / "custom" / "ben.wav"


def test_a_recording_deleted_since_listing_is_not_found(settings: Settings):
    ben = voices.find(settings.voices_dir, "custom-ben")
    (settings.voices_dir / "custom" / "ben.wav").unlink()

    with pytest.raises(NotFoundError):
        voices.sample_path(settings.voices_dir, ben, client=client(refuse))


def test_a_builtin_sample_is_downloaded_once_then_read_from_disk(tmp_path: Path):
    alice = voices.find(tmp_path, "alice")
    requested: list[str] = []

    def upstream(request: httpx.Request) -> httpx.Response:
        requested.append(str(request.url))
        return httpx.Response(200, content=SAMPLE)

    first = voices.sample_path(tmp_path, alice, client=client(upstream))
    second = voices.sample_path(tmp_path, alice, client=client(refuse))

    assert requested == [voices.SAMPLES_URL + "en-Alice_woman.wav"]
    assert first == second == tmp_path / "en-Alice_woman.wav"
    assert first.read_bytes() == SAMPLE
    assert list(tmp_path.glob("*.part")) == []


def test_a_failed_download_leaves_no_sample_behind(tmp_path: Path):
    frank = voices.find(tmp_path, "frank")
    missing = client(lambda request: httpx.Response(404))

    with pytest.raises(httpx.HTTPStatusError):
        voices.sample_path(tmp_path, frank, client=missing)

    assert list(tmp_path.iterdir()) == []

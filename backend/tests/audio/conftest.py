"""Fixtures for audio summaries: tmp audio, voice and skill folders, a small book, scripts.

Voices are your own recordings (`voices_dir/custom/*.wav`), so nothing is ever downloaded,
and narrations run on `FakeSpeechRunner`, so nothing is ever synthesised.
"""

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.pipeline import get_skills_dir
from app.core.config import Settings, get_settings
from app.main import create_app
from app.models import Artifact, Document
from app.models.enums import ArtifactType, Review
from tests.api.factories import make_artifact
from tests.pipeline.runtime.conftest import (
    AUDIO_SKILL,
    BOOK,
    add_document,
    add_nodes,
    script,
    section,
    turn,
    write_audio_skill,
)

# File stems under `voices_dir/custom`: they become `custom-ada-lovelace`, `custom-ben`, …
RECORDINGS = ("Ada Lovelace", "ben", "Cy_Twist")
WAV = b"RIFF\x00\x00\x00\x00WAVEfmt "

TWO_HOSTS = script(
    section(
        "Stocks",
        turn(1, "A **stock** is  memory.", "ch01/s01/p001"),
        turn(2, "Of what?", "ch01/s01/p001"),
    ),
    section("Flows", turn(1, "Of its flows.", "ch01/s02/p001")),
)


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    voices = tmp_path / "voices"
    (voices / "custom").mkdir(parents=True)
    for stem in RECORDINGS:
        (voices / "custom" / f"{stem}.wav").write_bytes(WAV)
    write_audio_skill(tmp_path / "skills")
    return get_settings().model_copy(
        update={
            "audio_dir": tmp_path / "audio",
            "voices_dir": voices,
            "skills_dir": tmp_path / "skills",
        }
    )


@pytest.fixture
def book(session: Session) -> Document:
    doc = add_document(session)
    add_nodes(session, doc, BOOK)
    return doc


@pytest.fixture
def api(settings: Settings) -> Iterator[TestClient]:
    """The real app, reading audio, voices and skills from the tmp folders."""
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_skills_dir] = lambda: settings.skills_dir
    with TestClient(app) as client:
        yield client


def add_script(
    session: Session,
    doc: Document,
    variant: str | None = "15m-conversation-en",
    *,
    body: dict[str, Any] | None = None,
    **overrides: Any,
) -> Artifact:
    """A stored `audio_summary` script (a draft of the default episode, two hosts)."""
    fields: dict[str, Any] = {"skill": AUDIO_SKILL, "review": Review.DRAFT, "variant": variant}
    return make_artifact(
        session,
        doc,
        type=ArtifactType.AUDIO_SUMMARY,
        body=body if body is not None else TWO_HOSTS,
        **(fields | overrides),
    )

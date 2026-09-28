"""The `narrate` job body against a real database, tmp folders and `FakeSpeechRunner`."""

from typing import Any

import pytest
from sqlmodel import Session

from app.audio import store
from app.audio.render import narrate
from app.audio.runner import FakeSpeechRunner, SpeechError
from app.core.config import Settings
from app.jobs import queue
from app.jobs.queue import JobSpec
from app.jobs.registry import PermanentJobError
from app.models import Artifact, Document, Job
from app.models.enums import ArtifactType, JobKind, JobState
from tests.api.factories import make_artifact
from tests.audio.conftest import add_script

CAST = ["custom-ada-lovelace", "custom-ben"]


def narrate_job(session: Session, script: Artifact, **payload: Any) -> Job:
    job = queue.enqueue(
        session,
        JobSpec(
            kind=JobKind.NARRATE,
            document_id=script.document_id,
            payload={"artifact_id": str(script.id), "voices": CAST, **payload},
        ),
    )
    assert job is not None
    return job


def voice(
    session: Session, script: Artifact, runner: FakeSpeechRunner, settings: Settings, **payload: Any
):
    """Run one narrate job, then close it as the worker would (so the next is not deduped)."""
    job = narrate_job(session, script, **payload)
    try:
        return narrate(session, job, runner=runner, settings=settings)
    finally:
        queue.complete(session, job)


def test_a_narration_writes_the_audio_and_its_timeline(
    session: Session, book: Document, settings: Settings
):
    script = add_script(session, book)
    runner = FakeSpeechRunner()

    outcome = narrate(session, narrate_job(session, script), runner=runner, settings=settings)

    key = store.render_key(CAST, runner.engine())
    (saved,) = store.list_renders(settings.audio_dir, book.id)
    assert outcome.state is JobState.DONE
    assert outcome.result == {
        "artifact_id": str(script.id),
        "render": key,
        "file": saved.file,
        "duration": 3.0,
        "voices": CAST,
    }
    assert (settings.audio_dir / saved.file).read_bytes() == b"ID3fake"
    assert [(m.start, m.title) for m in saved.sections] == [(0.0, "Stocks"), (2.0, "Flows")]
    assert saved.voices == tuple(CAST)
    (request,) = runner.calls
    assert request.voices == (
        settings.voices_dir / "custom" / "Ada Lovelace.wav",
        settings.voices_dir / "custom" / "ben.wav",
    )
    assert request.title == book.title
    assert request.sections[0].turns[0].text.startswith("This is an AI-generated audio summary")


def test_the_same_cast_again_is_a_free_skip_unless_forced(
    session: Session, book: Document, settings: Settings
):
    script = add_script(session, book)
    voice(session, script, FakeSpeechRunner(), settings)
    again, forced = FakeSpeechRunner(), FakeSpeechRunner()

    skipped = voice(session, script, again, settings)
    redone = voice(session, script, forced, settings, force=True)

    assert (skipped.state, skipped.result["reason"]) == (JobState.SKIPPED, "already narrated")
    assert again.calls == []
    assert redone.state is JobState.DONE
    assert len(forced.calls) == 1


def test_a_chinese_episode_is_introduced_in_chinese(
    session: Session, book: Document, settings: Settings
):
    script = add_script(session, book, "15m-conversation-zh")
    runner = FakeSpeechRunner()

    narrate(session, narrate_job(session, script), runner=runner, settings=settings)

    assert runner.calls[0].sections[0].turns[0].text.startswith("这是一段由人工智能生成的")


@pytest.mark.parametrize(
    ("voices", "problem"),
    [
        (["custom-ada-lovelace", "nobody"], "unknown voice 'nobody'"),
        (["custom-ada-lovelace"], "the script has 2 speakers"),
        ("custom-ben", "the script has 2 speakers"),
    ],
    ids=["unknown-voice", "too-few-voices", "not-a-list"],
)
def test_a_cast_that_does_not_fit_fails_permanently(
    session: Session, book: Document, settings: Settings, voices, problem
):
    job = narrate_job(session, add_script(session, book), voices=voices)
    runner = FakeSpeechRunner()

    with pytest.raises(PermanentJobError, match=problem):
        narrate(session, job, runner=runner, settings=settings)

    assert runner.calls == []


def test_only_an_audio_summary_can_be_narrated(
    session: Session, book: Document, settings: Settings
):
    summary = make_artifact(session, book, type=ArtifactType.CHAPTER_SUMMARY)

    with pytest.raises(PermanentJobError, match="not an audio summary"):
        narrate(
            session, narrate_job(session, summary), runner=FakeSpeechRunner(), settings=settings
        )


def test_a_job_without_a_script_id_fails_permanently(
    session: Session, book: Document, settings: Settings
):
    job = narrate_job(session, add_script(session, book), artifact_id="not-a-uuid")

    with pytest.raises(PermanentJobError, match="'not-a-uuid'"):
        narrate(session, job, runner=FakeSpeechRunner(), settings=settings)


def test_a_script_with_nothing_to_say_fails_permanently(
    session: Session, book: Document, settings: Settings
):
    silent = add_script(session, book, body={"title": "x", "speakers": [{}, {}], "sections": []})

    with pytest.raises(PermanentJobError, match="nothing to say"):
        narrate(session, narrate_job(session, silent), runner=FakeSpeechRunner(), settings=settings)


def test_a_speech_model_failure_is_retryable_and_stores_nothing(
    session: Session, book: Document, settings: Settings
):
    script = add_script(session, book)
    failing = FakeSpeechRunner(fail=SpeechError("exited with 1"))

    with pytest.raises(SpeechError):
        narrate(session, narrate_job(session, script), runner=failing, settings=settings)

    assert store.list_renders(settings.audio_dir, book.id) == []

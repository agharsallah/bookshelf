"""A parameterised skill against a real database: params join the inputs, each set is its
own episode (`variant`), and each episode keeps its own versions."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.jobs import queue
from app.jobs.queue import JobSpec
from app.jobs.registry import PermanentJobError
from app.models import Artifact, Document
from app.models.enums import ArtifactType, JobKind, JobState, Origin, Review
from app.pipeline.execution import execute_skill_job, prepare
from app.pipeline.runner import FakeRunner
from app.pipeline.skills import ParamError, Skill, load_catalogue
from tests.pipeline.runtime.conftest import (
    AUDIO_SKILL,
    reply,
    script,
    section,
    turn,
    write_audio_skill,
)

API = "/api/v1/artifacts"
CITE = "ch01/s01/p001"
SHORT = reply(script(section("Stocks", turn(1, "A stock remembers its flows.", CITE))))


@pytest.fixture
def audio(skills_dir: Path) -> Skill:
    write_audio_skill(skills_dir)
    return load_catalogue(skills_dir)[AUDIO_SKILL]


def derive(session: Session, doc: Document, skills_dir: Path, **payload: object):
    """Run one `derive` job of the audio skill with `payload`, then close it as the worker
    would, so the next one is not deduplicated against it."""
    job = queue.enqueue(
        session,
        JobSpec(kind=JobKind.DERIVE, document_id=doc.id, skill=AUDIO_SKILL, payload=payload),
    )
    assert job is not None
    runner = FakeRunner(SHORT)
    try:
        outcome = execute_skill_job(
            session, job, runner=runner, skills_dir=skills_dir, media_dir=Path("/media")
        )
    finally:
        queue.complete(session, job)
    return outcome, runner


def scripts(session: Session, doc: Document) -> list[Artifact]:
    rows = session.exec(select(Artifact).where(Artifact.document_id == doc.id)).all()
    return sorted(rows, key=lambda a: (a.variant or "", a.version))


def test_params_join_the_inputs_so_each_set_has_its_own_hash_and_variant(session, book, audio):
    default = prepare(session, audio, book, None)
    short = prepare(session, audio, book, None, params={"minutes": 5})
    typed = prepare(session, audio, book, None, params={"minutes": "5"})

    assert default.selection.inputs["params"] == {
        "minutes": 15,
        "format": "conversation",
        "language": "en",
    }
    assert (default.variant, short.variant) == ("15m-conversation-en", "5m-conversation-en")
    assert default.input_hash != short.input_hash
    assert short.input_hash == typed.input_hash


def test_a_skill_without_params_adds_none_to_its_inputs(session, book, skills_dir):
    summarize = load_catalogue(skills_dir)["summarize"]

    prepared = prepare(session, summarize, book, "ch02")

    assert "params" not in prepared.selection.inputs
    assert prepared.variant is None


def test_prepare_refuses_params_the_skill_does_not_take(session, book, audio):
    with pytest.raises(ParamError):
        prepare(session, audio, book, None, params={"voice": "alice"})


def test_a_batch_run_stores_the_episode_and_its_pace(session, book, audio, skills_dir):
    outcome, runner = derive(session, book, skills_dir, params={"minutes": 5, "format": "narrator"})

    (artifact,) = scripts(session, book)
    assert outcome.state is JobState.DONE
    assert (artifact.type, artifact.variant) == (ArtifactType.AUDIO_SUMMARY, "5m-narrator-en")
    assert outcome.result["variant"] == "5m-narrator-en"
    assert artifact.gates["pace"] == 1.0  # 5 spoken words over 5 minutes
    assert artifact.gates["flags"] == ["too_short_to_fill"]
    assert '"minutes": 5' in runner.calls[0]["prompt"]


def test_bad_params_in_a_job_fail_it_permanently(session, book, audio, skills_dir):
    with pytest.raises(PermanentJobError, match="bad params: minutes must be one of"):
        derive(session, book, skills_dir, params={"minutes": 45})

    assert scripts(session, book) == []


def test_two_episodes_of_one_book_each_start_at_version_one(session, book, audio, skills_dir):
    derive(session, book, skills_dir, params={"minutes": 5})
    derive(session, book, skills_dir, params={"minutes": 30})

    derive(session, book, skills_dir, params={"minutes": 5}, force=True)

    assert [(a.variant, a.version, a.review) for a in scripts(session, book)] == [
        ("30m-conversation-en", 1, Review.NEEDS_REVIEW),
        ("5m-conversation-en", 1, Review.REJECTED),
        ("5m-conversation-en", 2, Review.NEEDS_REVIEW),
    ]


def test_an_unchanged_episode_is_skipped_without_calling_the_model(
    session, book, audio, skills_dir
):
    stored, _ = derive(session, book, skills_dir, params={"minutes": 5})

    outcome, runner = derive(session, book, skills_dir, params={"minutes": "5"})

    assert outcome.state is JobState.SKIPPED
    assert outcome.result["artifact_id"] == stored.result["artifact_id"]
    assert runner.calls == []


# --- Scope = (document, anchor, type, note, variant) in the database and the API ------


def episode(session: Session, doc: Document, variant: str | None, version: int = 1) -> Artifact:
    row = Artifact(
        document_id=doc.id,
        type=ArtifactType.AUDIO_SUMMARY,
        variant=variant,
        version=version,
        origin=Origin.SKILL,
        skill=AUDIO_SKILL,
        skill_version="1",
        input_hash=f"{variant}-{version}",
        body=script(),
        review=Review.NEEDS_REVIEW,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def listed(api: TestClient, **params: object) -> dict[str, bool]:
    items = api.get(API, params=params).json()["items"]
    return {item["id"]: item["superseded"] for item in items}


def test_the_database_allows_one_version_one_per_variant_only(session: Session, book):
    episode(session, book, "5m-panel-en")
    episode(session, book, "15m-panel-en")

    with pytest.raises(IntegrityError):
        episode(session, book, "5m-panel-en")


def test_the_database_refuses_a_variant_that_is_not_a_slug(session: Session, book):
    with pytest.raises(IntegrityError):
        episode(session, book, "15 min, panel")


def test_one_episode_never_supersedes_another(api: TestClient, session, book):
    short = episode(session, book, "5m-panel-en")
    long = episode(session, book, "30m-panel-en", version=2)

    assert listed(api, latest=True) == {str(short.id): False, str(long.id): False}
    assert api.get(f"{API}/{long.id}").json()["variant"] == "30m-panel-en"


def test_a_newer_version_of_the_same_episode_supersedes_it(api: TestClient, session, book):
    old = episode(session, book, "5m-panel-en")
    new = episode(session, book, "5m-panel-en", version=2)

    assert listed(api) == {str(old.id): True, str(new.id): False}


def test_version_history_of_an_episode_excludes_the_other_episodes(api: TestClient, session, book):
    mine = episode(session, book, "5m-panel-en")
    episode(session, book, "30m-panel-en", version=2)
    mine_again = episode(session, book, "5m-panel-en", version=3)

    versions = api.get(f"{API}/{mine.id}/versions").json()

    assert [v["id"] for v in versions] == [str(mine.id), str(mine_again.id)]

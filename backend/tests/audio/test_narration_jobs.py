"""How narrations get queued: `POST /jobs` (a new episode, or voicing a script again), the
orchestrator after a script is written, and importing an interactive run's script."""

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import Settings
from app.jobs import queue
from app.jobs.queue import JobSpec
from app.models import Document, Job
from app.models.enums import ArtifactType, JobKind, JobState
from app.pipeline import orchestrator
from tests.api.factories import make_artifact
from tests.audio.conftest import add_script
from tests.conftest import AUTH
from tests.pipeline.runtime.conftest import (
    AUDIO_SKILL,
    SKILLS,
    add_document,
    script,
    section,
    turn,
    write_skill,
)

URL = "/api/v1/jobs"
EPISODE = {"minutes": 5, "format": "panel", "language": "en"}


def post(api: TestClient, **body: Any) -> tuple[int, dict]:
    response = api.post(URL, json=body, headers=AUTH)
    return response.status_code, response.json()


def stored(session: Session, job_id: str) -> Job:
    session.expire_all()
    job = session.get(Job, job_id)
    assert job is not None
    return job


def narrations(session: Session) -> list[Job]:
    session.expire_all()
    return list(session.exec(select(Job).where(Job.kind == JobKind.NARRATE)))


def error_field(body: dict) -> str:
    return body["error"]["details"][0]["field"]


# --- POST /jobs {kind: derive}: a new episode ------------------------------------------


def test_a_new_episode_carries_its_resolved_params_and_cast(api, session, book: Document):
    status, body = post(
        api,
        kind="derive",
        document_id=str(book.id),
        skill=AUDIO_SKILL,
        params={"minutes": "5", "format": "panel"},
        voices=["maya", "carter", "samuel"],
    )

    job = stored(session, body["job"]["id"])
    assert status == 202
    assert job.payload == {"params": EPISODE, "voices": ["maya", "carter", "samuel"]}
    assert job.input_hash == f"skill:{AUDIO_SKILL}:5m-panel-en:maya+carter+samuel"


def test_without_voices_an_episode_gets_its_formats_default_cast(api, session, book: Document):
    _, body = post(
        api,
        kind="derive",
        document_id=str(book.id),
        skill=AUDIO_SKILL,
        params={"format": "panel", "language": "zh"},
    )

    assert stored(session, body["job"]["id"]).payload["voices"] == ["xinran", "bowen", "anchen"]


def test_episodes_dedupe_per_params_and_per_cast(api, book: Document):
    ask = {"kind": "derive", "document_id": str(book.id), "skill": AUDIO_SKILL}
    _, first = post(api, **ask, params={"minutes": 5})
    _, same = post(api, **ask, params={"minutes": "5"}, voices=["alice", "frank"])
    _, longer = post(api, **ask, params={"minutes": 30})
    _, recast = post(api, **ask, params={"minutes": 5}, voices=["frank", "alice"])

    assert (same["deduplicated"], same["job"]["id"]) == (True, first["job"]["id"])
    assert (longer["deduplicated"], recast["deduplicated"]) == (False, False)


@pytest.mark.parametrize(
    ("extra", "field"),
    [
        ({"params": {"minutes": 7}}, "params.minutes"),
        ({"params": {"speed": 2}}, "params.speed"),
        ({"voices": ["alice"]}, "body.voices"),
        ({"voices": ["alice", "nobody"]}, "body.voices"),
    ],
    ids=["param-out-of-choices", "unknown-param", "voice-count", "unknown-voice"],
)
def test_a_bad_episode_request_is_422_on_the_field_at_fault(api, book: Document, extra, field):
    status, body = post(api, kind="derive", document_id=str(book.id), skill=AUDIO_SKILL, **extra)

    assert (status, error_field(body)) == (422, field)


@pytest.mark.parametrize(
    ("extra", "field"),
    [({"params": {"minutes": 5}}, "body.params"), ({"voices": ["alice"]}, "body.voices")],
)
def test_a_skill_without_params_takes_neither_params_nor_voices(
    api, settings: Settings, book: Document, extra, field
):
    write_skill(settings.skills_dir, "make-quiz", **dict(SKILLS["make-quiz"]))

    status, body = post(
        api, kind="derive", document_id=str(book.id), anchor="ch01", skill="make-quiz", **extra
    )

    assert (status, error_field(body)) == (422, field)


# --- POST /jobs {kind: narrate}: voice a script again ------------------------------------


def test_narrate_voices_one_script_with_the_cast_asked_for(api, session, book: Document):
    script_row = add_script(session, book)

    status, body = post(
        api,
        kind="narrate",
        document_id=str(book.id),
        artifact_id=str(script_row.id),
        voices=["maya", "carter"],
        force=True,
    )

    job = stored(session, body["job"]["id"])
    assert status == 202
    assert job.payload == {
        "artifact_id": str(script_row.id),
        "voices": ["maya", "carter"],
        "force": True,
    }
    assert job.input_hash == f"narrate:{script_row.id}:maya+carter"


def test_narrate_without_voices_uses_the_default_cast_of_the_scripts_language(
    api, session, book: Document
):
    script_row = add_script(session, book, "15m-conversation-zh")

    _, body = post(api, kind="narrate", document_id=str(book.id), artifact_id=str(script_row.id))

    assert stored(session, body["job"]["id"]).payload["voices"] == ["xinran", "bowen"]


def test_narrate_needs_an_audio_summary_of_that_document(api, session, book: Document):
    other = add_document(session, slug="senge-fifth-discipline")
    elsewhere = add_script(session, other)
    summary = make_artifact(session, book, type=ArtifactType.CHAPTER_SUMMARY)
    doc = str(book.id)

    answers = [
        post(api, kind="narrate", document_id=doc),
        post(api, kind="narrate", document_id=doc, artifact_id=str(elsewhere.id)),
        post(api, kind="narrate", document_id=doc, artifact_id=str(summary.id)),
    ]

    assert [(status, error_field(body)) for status, body in answers] == [
        (422, "body.artifact_id")
    ] * 3


def test_narrate_with_a_cast_that_does_not_fit_the_script_is_422(api, session, book: Document):
    script_row = add_script(session, book)

    status, body = post(
        api,
        kind="narrate",
        document_id=str(book.id),
        artifact_id=str(script_row.id),
        voices=["alice"],
    )

    assert (status, error_field(body)) == (422, "body.voices")
    assert "2 speakers" in body["error"]["message"]


# --- The orchestrator: a written script queues its narration -----------------------------


def finished_derive(
    session: Session, doc: Document, state: JobState, result: dict[str, Any], **payload: Any
) -> Job:
    job = queue.enqueue(
        session,
        JobSpec(kind=JobKind.DERIVE, document_id=doc.id, skill=AUDIO_SKILL, payload=payload),
    )
    assert job is not None
    queue.complete(session, job, state=state, result=result)
    return job


@pytest.mark.parametrize("state", [JobState.DONE, JobState.SKIPPED])
def test_a_finished_episode_run_queues_its_narration_with_the_cast_it_asked_for(
    session, book: Document, state
):
    script_row = add_script(session, book)
    job = finished_derive(
        session, book, state, {"artifact_id": str(script_row.id)}, voices=["maya", "carter"]
    )

    (queued,) = orchestrator.on_job_done(session, job)

    assert (queued.kind, queued.document_id) == (JobKind.NARRATE, book.id)
    assert queued.payload == {"artifact_id": str(script_row.id), "voices": ["maya", "carter"]}


def test_an_episode_run_without_a_cast_queues_nothing(session, book: Document):
    made = {"artifact_id": str(add_script(session, book).id)}
    job = finished_derive(session, book, JobState.DONE, made)

    assert orchestrator.on_job_done(session, job) == []


def test_a_derive_run_that_made_other_study_material_queues_no_narration(session, book: Document):
    quiz = make_artifact(session, book, type=ArtifactType.QUIZ)
    job = finished_derive(
        session, book, JobState.DONE, {"artifact_id": str(quiz.id)}, voices=["alice"]
    )

    assert orchestrator.on_job_done(session, job) == []


# --- Interactive mode: params through the inputs endpoint and the import ------------------

NARRATOR = script(
    section("Stocks", turn(1, "A stock remembers its flows.", "ch01/s01/p001")), speakers=1
)


def test_an_imported_episode_keeps_its_variant_and_queues_a_default_narration(
    api, session, book: Document
):
    inputs = api.get(
        f"/api/v1/skills/{AUDIO_SKILL}/inputs",
        params={"document": book.slug, "params": ["minutes:5", "format:narrator"]},
    )
    envelope = {
        "skill": AUDIO_SKILL,
        "document": book.slug,
        "output": NARRATOR,
        "input_hash": inputs.json()["input_hash"],
    }

    stale = api.post("/api/v1/artifacts/import", json=envelope, headers=AUTH)
    imported = api.post(
        "/api/v1/artifacts/import",
        headers=AUTH,
        json={**envelope, "params": {"minutes": 5, "format": "narrator"}},
    )

    assert inputs.json()["inputs"]["params"] == {
        "minutes": 5,
        "format": "narrator",
        "language": "en",
    }
    assert stale.status_code == 409  # without its params the inputs are the default episode's
    assert imported.status_code == 201
    assert imported.json()["variant"] == "5m-narrator-en"
    (narration,) = narrations(session)
    assert narration.payload == {"artifact_id": imported.json()["id"], "voices": ["alice"]}


def test_inputs_with_a_param_outside_its_choices_are_422(api, book: Document):
    response = api.get(
        f"/api/v1/skills/{AUDIO_SKILL}/inputs",
        params={"document": book.slug, "params": "minutes:7"},
    )

    assert response.status_code == 422
    assert error_field(response.json()) == "params.minutes"

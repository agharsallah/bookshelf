"""Artifacts and skills endpoints (§13), against the real app and database."""

from sqlmodel import Session, select

from app.models import Artifact, Document, Job, Note
from app.models.enums import ArtifactType, JobKind, Origin, Review
from tests.conftest import AUTH
from tests.pipeline.runtime.conftest import body, paragraph

API = "/api/v1"


def skill_artifact(session: Session, doc: Document, kind: ArtifactType, anchor: str | None,
                   blocks: list, version: int = 1) -> Artifact:  # fmt: skip
    artifact = Artifact(
        document_id=doc.id, anchor=anchor, type=kind, version=version, origin=Origin.SKILL,
        skill="distil-chapter", skill_version="1", input_hash=f"h{anchor}{version}",
        body={"blocks": blocks},
    )  # fmt: skip
    session.add(artifact)
    session.commit()
    return artifact


WARNING = {
    "type": "callout",
    "tone": "antipattern",
    "spans": [{"text": "Don't.", "cites": ["ch02/p001"]}],
}


def test_tone_filter_returns_artifacts_with_that_callout_and_the_matching_blocks(
    api, session, book
):
    hit = skill_artifact(
        session,
        book,
        ArtifactType.CHAPTER_DISTILLATION,
        "ch02",
        [paragraph("a", "ch02/p001"), WARNING],
    )
    skill_artifact(
        session, book, ArtifactType.CHAPTER_DISTILLATION, "ch01", [paragraph("b", "ch01/s01/p001")]
    )

    page = api.get(f"{API}/artifacts", params={"tone": "antipattern"}).json()

    assert page["total"] == 1
    assert page["items"][0]["id"] == str(hit.id)
    assert page["items"][0]["matched_blocks"] == [WARNING]


def test_list_filters_by_document_type_review_and_anchor_prefix(api, session, book):
    note = skill_artifact(session, book, ArtifactType.SECTION_NOTE, "ch01/s01", [])
    skill_artifact(session, book, ArtifactType.SECTION_NOTE, "ch02", [])
    skill_artifact(session, book, ArtifactType.CHAPTER_DISTILLATION, "ch01", [])

    params = {
        "document_id": str(book.id),
        "type": "section_note",
        "review": "draft",
        "anchor_prefix": "ch01",
    }
    page = api.get(f"{API}/artifacts", params=params).json()

    assert [item["id"] for item in page["items"]] == [str(note.id)]


def test_edit_stores_a_new_approved_human_version_and_keeps_the_draft(api, session, book):
    draft = skill_artifact(
        session, book, ArtifactType.SECTION_NOTE, "ch01/s01", [paragraph("draft", "ch01/s01/p001")]
    )
    skill_artifact(
        session, book, ArtifactType.SECTION_NOTE, "ch01/s02", [paragraph("other", "ch01/s02/p001")]
    )
    edit = body(paragraph("my words", "ch01/s01/p001"))

    response = api.post(
        f"{API}/artifacts/{draft.id}/review", json={"action": "edit", "body": edit}, headers=AUTH
    )

    assert response.status_code == 200
    edited = response.json()
    assert (edited["version"], edited["origin"], edited["review"]) == (2, "human", "approved")
    assert edited["skill"] is None and edited["reviewed_at"] is not None
    versions = api.get(f"{API}/artifacts/{draft.id}/versions").json()
    assert [(v["version"], v["origin"], v["review"]) for v in versions] == [
        (1, "skill", "draft"), (2, "human", "approved"),
    ]  # fmt: skip
    chapter_jobs = session.exec(select(Job).where(Job.kind == JobKind.DISTIL_CHAPTER)).all()
    assert [j.anchor for j in chapter_jobs] == ["ch01"]  # approval propagated upward


def test_approve_and_reject_set_review_and_timestamp(api, session, book):
    artifact = skill_artifact(session, book, ArtifactType.CHAPTER_SUMMARY, "ch02", [])

    approved = api.post(
        f"{API}/artifacts/{artifact.id}/review", json={"action": "approve"}, headers=AUTH
    ).json()
    rejected = api.post(
        f"{API}/artifacts/{artifact.id}/review", json={"action": "reject"}, headers=AUTH
    ).json()

    assert approved["review"] == "approved" and approved["reviewed_at"] is not None
    assert rejected["review"] == "rejected"


def test_review_needs_the_api_key(api, session, book):
    artifact = skill_artifact(session, book, ArtifactType.CHAPTER_SUMMARY, "ch02", [])

    assert (
        api.post(f"{API}/artifacts/{artifact.id}/review", json={"action": "approve"}).status_code
        == 401
    )


def test_human_artifact_skips_grounding_but_not_anchor_validity(api, session, book):
    uncited = {"document_id": str(book.id), "type": "chapter_distillation", "anchor": "ch02",
               "body": body(paragraph("my own summary"))}  # fmt: skip
    ghost = {**uncited, "body": body(paragraph("x", "ch09/p001"))}

    created = api.post(f"{API}/artifacts", json=uncited, headers=AUTH)
    rejected = api.post(f"{API}/artifacts", json=ghost, headers=AUTH)

    assert created.status_code == 201
    assert (created.json()["origin"], created.json()["review"]) == ("human", "approved")
    assert rejected.status_code == 422
    assert rejected.json()["error"]["code"] == "gate_rejected"
    assert "ch09/p001" in rejected.json()["error"]["details"][0]["message"]


def test_inputs_endpoint_and_import_round_trip(api, session, book):
    inputs = api.get(
        f"{API}/skills/summarize/inputs", params={"document": "meadows-systems", "anchor": "ch02"}
    ).json()
    envelope = {
        "skill": "summarize",
        "document": "meadows-systems",
        "anchor": "ch02",
        "input_hash": inputs["input_hash"],
        "output": body(paragraph("Loops.", "ch02/p001")),
    }

    imported = api.post(f"{API}/artifacts/import", json=envelope, headers=AUTH)
    again = api.post(f"{API}/artifacts/import", json=envelope, headers=AUTH)

    assert [b["anchor"] for b in inputs["inputs"]["blocks"]] == ["ch02/p001", "ch02/c001"]
    assert imported.status_code == 201
    assert (imported.json()["run_mode"], imported.json()["origin"]) == ("interactive", "skill")
    assert imported.json()["input_hash"] == inputs["input_hash"]
    assert again.status_code == 409


def test_import_with_a_stale_input_hash_is_refused(api, book):
    envelope = {
        "skill": "summarize",
        "document": str(book.id),
        "anchor": "ch02",
        "input_hash": "0" * 64,
        "output": body(paragraph("Loops.", "ch02/p001")),
    }

    response = api.post(f"{API}/artifacts/import", json=envelope, headers=AUTH)

    assert response.status_code == 409
    assert "input_hash does not match" in response.json()["error"]["message"]


def test_skill_catalogue_lists_packages_with_their_gates(api):
    skills = {s["name"]: s for s in api.get(f"{API}/skills").json()}

    assert skills["distil-chapter"]["job_kind"] == "distil_chapter"
    assert skills["distil-chapter"]["gates"] == {
        "grounding_min": 0.9,
        "compression": None,
        "max_words": None,
        "coverage_min": None,
    }
    assert skills["parse-outline"]["job_kind"] is None


def test_unknown_skill_and_artifact_are_404(api, book):
    assert (
        api.get(f"{API}/skills/nope/inputs", params={"document": "meadows-systems"}).status_code
        == 404
    )
    assert api.get(f"{API}/artifacts/{book.id}").status_code == 404


def test_review_with_an_invalid_edit_is_rejected(api, session, book):
    artifact = skill_artifact(session, book, ArtifactType.CHAPTER_SUMMARY, "ch02", [])

    invalid = {"action": "edit", "body": {"blocks": [{"type": "nope"}]}}
    response = api.post(f"{API}/artifacts/{artifact.id}/review", json=invalid, headers=AUTH)

    assert response.status_code == 422
    assert session.exec(select(Artifact).where(Artifact.review == Review.APPROVED)).all() == []


def test_note_inputs_by_note_id_import_against_the_note_anchor(api, session, book):
    note = Note(document_id=book.id, anchor="ch02/p001", raw="goal seeking")
    session.add(note)
    session.commit()
    params = {"document": "meadows-systems", "note_id": str(note.id)}
    inputs = api.get(f"{API}/skills/structure-note/inputs", params=params).json()
    envelope = {
        "skill": "structure-note",
        "document": "meadows-systems",
        "note_id": str(note.id),  # no anchor: the note's passage is the scope
        "input_hash": inputs["input_hash"],
        "output": body(paragraph("Goal seeking.", "ch02/p001")),
    }

    imported = api.post(f"{API}/artifacts/import", json=envelope, headers=AUTH).json()

    assert inputs["inputs"]["note"]["raw"] == "goal seeking"
    assert (imported["anchor"], imported["note_id"]) == ("ch02/p001", str(note.id))

"""The generic skill handler against a real database and a FakeRunner."""

from pathlib import Path

import pytest
from sqlmodel import Session, select

from app.jobs import queue
from app.jobs.registry import PermanentJobError, get_handler
from app.models import Artifact, Document, Note
from app.models.enums import ArtifactType, JobKind, JobState, Origin, Review, RunMode, Tier
from app.pipeline.execution import execute_skill_job
from app.pipeline.runner import FakeRunner
from tests.pipeline.runtime.conftest import body, paragraph, reply

GROUNDED = reply(body(paragraph("A stock remembers its flows.", "ch01/s01/p001")))


def run(session: Session, job, runner: FakeRunner, skills_dir: Path, **kwargs):
    return execute_skill_job(
        session, job, runner=runner, skills_dir=skills_dir, media_dir=Path("/media"), **kwargs
    )


def artifacts_of(session: Session, doc: Document) -> list[Artifact]:
    return list(session.exec(select(Artifact).where(Artifact.document_id == doc.id)))


def test_every_skill_backed_kind_has_the_generic_handler_registered():
    import app.pipeline.handlers.skills as module

    assert get_handler(JobKind.DISTIL_SECTION) is module.run_skill
    assert get_handler(JobKind.DERIVE) is module.run_skill
    assert get_handler(JobKind.PARSE) is not module.run_skill


def test_skill_run_stores_a_draft_artifact_with_gates_and_provenance(
    session, book, make_job, skills_dir
):
    runner = FakeRunner(GROUNDED, model="claude-sonnet-5")
    job = make_job(JobKind.DISTIL_SECTION, book, "ch01/s01")

    outcome = run(session, job, runner, skills_dir)

    (artifact,) = artifacts_of(session, book)
    assert outcome.state is JobState.DONE
    assert outcome.result["artifact_id"] == str(artifact.id)
    assert outcome.cost_tokens == 10
    assert (artifact.type, artifact.anchor, artifact.version) == (
        ArtifactType.SECTION_NOTE, "ch01/s01", 1
    )  # fmt: skip
    assert (artifact.origin, artifact.skill, artifact.skill_version) == (
        Origin.SKILL, "distil-section", "1"
    )  # fmt: skip
    assert (artifact.model, artifact.tier, artifact.run_mode) == (
        "claude-sonnet-5", Tier.DISTIL, RunMode.BATCH
    )  # fmt: skip
    assert artifact.review is Review.DRAFT
    assert artifact.citations == ["ch01/s01/p001"]
    assert artifact.gates == {
        "grounding": 1.0, "compression": None, "words": 5, "flags": [], "schema_retry": False,
    }  # fmt: skip
    assert artifact.input_hash == outcome.result["input_hash"]
    assert '"anchor": "ch01/s01/p001"' in runner.calls[0]["prompt"]
    assert "interactive:start" not in runner.calls[0]["prompt"]


def test_unchanged_input_is_skipped_without_calling_the_model(session, book, make_job, skills_dir):
    first = make_job(JobKind.DISTIL_SECTION, book, "ch01/s01")
    run(session, first, FakeRunner(GROUNDED), skills_dir)
    queue.complete(session, first)
    runner = FakeRunner(GROUNDED)

    outcome = run(session, make_job(JobKind.DISTIL_SECTION, book, "ch01/s01"), runner, skills_dir)

    assert outcome.state is JobState.SKIPPED
    assert runner.calls == []
    assert len(artifacts_of(session, book)) == 1


def test_force_reruns_and_supersedes_the_previous_output(session, book, make_job, skills_dir):
    first = make_job(JobKind.DISTIL_SECTION, book, "ch01/s01")
    run(session, first, FakeRunner(GROUNDED), skills_dir)
    queue.complete(session, first)

    forced = make_job(JobKind.DISTIL_SECTION, book, "ch01/s01", force=True)
    outcome = run(session, forced, FakeRunner(GROUNDED), skills_dir)

    old, new = sorted(artifacts_of(session, book), key=lambda a: a.version)
    assert outcome.state is JobState.DONE
    assert (old.version, old.review) == (1, Review.REJECTED)
    assert (new.version, new.review) == (2, Review.DRAFT)


def test_low_grounding_lands_in_needs_review(session, book, make_job, skills_dir):
    half = reply(body(paragraph("cited", "ch01/s01/p001"), paragraph("made up")))

    run(session, make_job(JobKind.DISTIL_SECTION, book, "ch01/s01"), FakeRunner(half), skills_dir)

    (artifact,) = artifacts_of(session, book)
    assert artifact.review is Review.NEEDS_REVIEW
    assert artifact.gates["grounding"] == 0.5
    assert artifact.gates["flags"] == ["grounding_below_min"]


def test_invalid_anchor_is_retried_once_then_fails_permanently(session, book, make_job, skills_dir):
    ghost = reply(body(paragraph("From another book.", "ch09/p001")))
    runner = FakeRunner(ghost)

    with pytest.raises(PermanentJobError, match="ch09/p001"):
        run(session, make_job(JobKind.DISTIL_SECTION, book, "ch01/s01"), runner, skills_dir)

    assert len(runner.calls) == 2
    assert "cited anchors do not exist in this document: ch09/p001" in runner.calls[1]["prompt"]
    assert artifacts_of(session, book) == []


def test_a_fixed_reply_on_retry_is_stored_and_marked(session, book, make_job, skills_dir):
    runner = FakeRunner("Sure! Here is the note.", GROUNDED)

    run(session, make_job(JobKind.DISTIL_SECTION, book, "ch01/s01"), runner, skills_dir)

    (artifact,) = artifacts_of(session, book)
    assert artifact.gates["schema_retry"] is True


def test_vision_skill_receives_the_figure_image_path(session, book, make_job, skills_dir):
    described = reply(body(paragraph("A bathtub.", "ch01/s01/f001"), confidence="high"))
    runner = FakeRunner(described)

    run(session, make_job(JobKind.DESCRIBE_FIGURE, book, "ch01/s01/f001"), runner, skills_dir)

    assert runner.calls[0]["images"] == [Path("/media/f001.png")]
    assert runner.calls[0]["tier"] is Tier.EXPLORE


def test_run_ceiling_fails_permanently_before_calling_the_model(
    session, book, make_job, skills_dir
):
    earlier = make_job(JobKind.SUMMARIZE, book, "ch02")
    queue.claim(session)
    queue.complete(session, earlier)
    runner = FakeRunner(GROUNDED)

    with pytest.raises(PermanentJobError, match="run ceiling"):
        run(
            session,
            make_job(JobKind.DISTIL_SECTION, book, "ch01/s01"),
            runner,
            skills_dir,
            max_runs=1,
        )

    assert runner.calls == []


def test_unknown_anchor_fails_permanently(session, book, make_job, skills_dir):
    with pytest.raises(PermanentJobError, match="no anchor 'ch07'"):
        run(session, make_job(JobKind.SUMMARIZE, book, "ch07"), FakeRunner(GROUNDED), skills_dir)


def test_derive_runs_the_skill_named_in_the_payload(session, book, make_job, skills_dir):
    job = make_job(JobKind.DERIVE, book, "ch02", skill="make-quiz")
    quiz = reply(body(paragraph("Q: what do balancing loops seek?", "ch02/p001")))

    run(session, job, FakeRunner(quiz), skills_dir)

    (artifact,) = artifacts_of(session, book)
    assert (artifact.type, artifact.skill) == (ArtifactType.QUIZ, "make-quiz")


def test_interactive_only_skills_are_skipped_gracefully(session, book, make_job, skills_dir):
    job = make_job(JobKind.DERIVE, book, None, skill="parse-outline")
    runner = FakeRunner("{}")

    outcome = run(session, job, runner, skills_dir)

    assert outcome.state is JobState.SKIPPED
    assert runner.calls == []


def test_structure_note_links_the_artifact_to_its_note(session, book, make_job, skills_dir):
    note = Note(
        document_id=book.id, anchor="ch02/p001", raw="goal-seeking!", range={"start": 0, "end": 9}
    )
    session.add(note)
    session.commit()
    runner = FakeRunner(reply(body(paragraph("Balancing loops seek goals.", "ch02/p001"))))

    run(
        session,
        make_job(JobKind.STRUCTURE_NOTE, book, "ch02/p001", note_id=str(note.id)),
        runner,
        skills_dir,
    )

    (artifact,) = artifacts_of(session, book)
    assert artifact.note_id == note.id
    assert '"highlighted_text": "Balancing"' in runner.calls[0]["prompt"]

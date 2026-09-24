"""The generic skill handler against a real database and a FakeRunner."""

from pathlib import Path

import pytest
from sqlmodel import Session, select

from app.jobs import queue
from app.jobs.registry import PermanentJobError, get_handler
from app.models import Artifact, Document, Note
from app.models.enums import (
    ArtifactType,
    JobKind,
    JobState,
    NoteTarget,
    Origin,
    Review,
    RunMode,
    Tier,
)
from app.pipeline.execution import execute_skill_job, prepare
from app.pipeline.runner import FakeRunner
from app.pipeline.skills import load_catalogue
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
        "repairs": [],
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


def test_a_shape_slip_is_repaired_without_a_retry_and_recorded(session, book, make_job, skills_dir):
    slip = {"type": "paragraph", "text": "A stock.", "cites": ["ch01/s01/p001"]}
    slipped = reply({"blocks": [slip]})
    runner = FakeRunner(slipped)

    run(session, make_job(JobKind.DISTIL_SECTION, book, "ch01/s01"), runner, skills_dir)

    (artifact,) = artifacts_of(session, book)
    assert len(runner.calls) == 1
    assert artifact.body == body(paragraph("A stock.", "ch01/s01/p001"))
    assert artifact.gates["schema_retry"] is False
    assert artifact.gates["repairs"] == ["paragraph: text → spans"]


def test_vision_skill_receives_the_figure_image_path(session, book, make_job, skills_dir):
    described = reply(body(paragraph("A bathtub.", "ch01/s01/f001"), confidence="high"))
    runner = FakeRunner(described)

    run(session, make_job(JobKind.DESCRIBE_FIGURE, book, "ch01/s01/f001"), runner, skills_dir)

    assert runner.calls[0]["images"] == [Path("/media/f001.png")]
    assert runner.calls[0]["tier"] is Tier.EXPLORE


def test_image_paths_are_hashed_relative_and_resolved_only_in_the_prompt(
    session, book, make_job, skills_dir
):
    skill = load_catalogue(skills_dir)["describe-figure"]
    here = prepare(session, skill, book, "ch01/s01/f001", media_dir=Path("/checkout/a/.media"))
    there = prepare(session, skill, book, "ch01/s01/f001", media_dir=Path("/elsewhere/.media"))
    runner = FakeRunner(reply(body(paragraph("A bathtub.", "ch01/s01/f001"), confidence="high")))

    run(session, make_job(JobKind.DESCRIBE_FIGURE, book, "ch01/s01/f001"), runner, skills_dir)

    assert here.input_hash == there.input_hash
    assert here.selection.inputs["element"]["image_path"] == "f001.png"
    assert '"image_path": "/media/f001.png"' in runner.calls[0]["prompt"]


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


def test_structure_note_on_a_summary_quotes_the_marked_words(session, book, make_job, skills_dir):
    note = Note(
        document_id=book.id,
        anchor="ch02",
        raw="so this is the gist",
        target=NoteTarget.CHAPTER_SUMMARY,
        block=0,
        range={"start": 0, "end": 10},
        quote="Loops pull",
    )
    session.add(note)
    session.commit()
    runner = FakeRunner(reply(body(paragraph("Balancing loops seek goals.", "ch02"))))

    run(
        session,
        make_job(JobKind.STRUCTURE_NOTE, book, "ch02", note_id=str(note.id)),
        runner,
        skills_dir,
    )

    prompt = runner.calls[0]["prompt"]
    assert '"highlighted_text": "Loops pull"' in prompt
    assert '"marks": "chapter_summary"' in prompt


def test_the_model_runs_with_no_database_transaction_open(session, book, make_job, skills_dir):
    """A CLI run takes minutes; the job's session must not sit idle in a transaction (a
    pooled connection, plus row locks that block enqueues of the same scope) meanwhile."""
    from tests.conftest import idle_transactions

    seen: list[int] = []

    def model(prompt: str) -> str:
        seen.append(idle_transactions())
        return GROUNDED

    job = make_job(JobKind.DISTIL_SECTION, book, "ch01/s01")
    outcome = run(session, job, FakeRunner(model), skills_dir)

    assert outcome.state is JobState.DONE
    assert seen == [0]


def _flags(session, book, job, runner, skills_dir) -> tuple[Review, list[str]]:
    run(session, job, runner, skills_dir)
    (artifact,) = artifacts_of(session, book)
    return artifact.review, artifact.gates["flags"]


def test_citing_a_real_anchor_the_skill_never_saw_needs_review(session, book, make_job, skills_dir):
    """A section note citing another chapter's passage cites something it was not shown:
    grounded on paper, invented in fact. Soft flag, not a rejection (the anchor exists)."""
    elsewhere = reply(body(paragraph("Balancing loops resist change.", "ch02/p001")))
    job = make_job(JobKind.DISTIL_SECTION, book, "ch01/s01")

    assert _flags(session, book, job, FakeRunner(elsewhere), skills_dir) == (
        Review.NEEDS_REVIEW,
        ["out_of_scope_cites"],
    )


@pytest.mark.parametrize(
    ("cite", "flags"),
    [
        ("ch02/c001", []),  # the element itself (its scope)
        ("ch01/s02/p001", []),  # outside the scope, but shown as context in the input
        ("ch01/s01/p001", ["out_of_scope_cites"]),  # exists, never shown
    ],
)
def test_a_cite_may_point_at_the_scope_or_anything_the_inputs_showed(
    session, book, make_job, skills_dir, cite: str, flags: list[str]
):
    output = reply(body(paragraph("The loop adds inflow until the goal.", cite), confidence="high"))
    job = make_job(JobKind.EXPLAIN_CODE, book, "ch02/c001")

    assert _flags(session, book, job, FakeRunner(output), skills_dir)[1] == flags


def test_interactive_imports_get_the_same_scope_check(session, book, skills_dir):
    from app.pipeline import interactive

    skill = load_catalogue(skills_dir)["summarize"]
    current = prepare(session, skill, book, "ch02").input_hash

    artifact = interactive.import_output(
        session, skill="summarize", document=book.slug, anchor="ch02", input_hash=current,
        output=body(paragraph("Stocks remember.", "ch01/s01/p001")), skills_dir=skills_dir,
    )  # fmt: skip

    assert (artifact.review, artifact.gates["flags"]) == (
        Review.NEEDS_REVIEW,
        ["out_of_scope_cites"],
    )

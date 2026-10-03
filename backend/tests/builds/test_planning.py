"""`build_plan`: the planner's input, a valid plan stored, an unusable one failing the build."""

import json

import pytest
from sqlmodel import Session

from app.builds import planning, service
from app.core.config import get_settings
from app.jobs.registry import PermanentJobError, get_handler
from app.models import Build, Document, Job
from app.models.build import BuildState, StopReason
from app.models.enums import JobKind, JobState, Origin
from app.pipeline.runner import FakeRunner, RunnerError
from app.pipeline.skills import Skill, load_skill
from app.schemas.builds import BuildCreate
from tests.builds.factories import GOAL, FakeProbe, known_paper, valid_plan


@pytest.fixture
def skill() -> Skill:
    return load_skill(get_settings().skills_dir / planning.SKILL_NAME)


def new_build(session: Session, **body: object) -> tuple[Build, Job]:
    paper = known_paper(session)
    build = service.create_build(session, paper, BuildCreate.model_validate({"goal": GOAL, **body}),
                                 probe=FakeProbe())  # fmt: skip
    job = session.get(Job, build.plan_job_id)
    assert job is not None
    return build, job


def test_a_valid_plan_is_stored_and_the_build_is_planned(session: Session, skill: Skill):
    build, job = new_build(session, preset="minimal-implementation")
    runner = FakeRunner(json.dumps(valid_plan()))

    result = planning.plan_build(session, job, runner=runner, skill=skill)

    session.refresh(build)
    assert build.state is BuildState.PLANNED and build.plan_origin is Origin.SKILL
    assert build.plan == valid_plan()
    assert result.result["milestones"] == len(valid_plan()["milestones"])
    prompt = runner.calls[0]["prompt"]
    assert GOAL in prompt and "## TL;DR" in prompt and "minimal-implementation" in prompt


def test_the_input_carries_feedback_and_the_previous_plan_only_on_a_replan(session: Session):
    build, _ = new_build(session)
    paper = session.get(Document, build.document_id)
    assert paper is not None

    first = planning.plan_input(session, build, paper)
    build.plan, build.plan_feedback = valid_plan(), "Fewer files."
    again = planning.plan_input(session, build, paper)

    assert first["feedback"] is None and first["previous_plan"] is None and first["preset"] is None
    assert again["feedback"] == "Fewer files." and again["previous_plan"] == valid_plan()
    assert again["stops"]["max_minutes"] == 90 and "cites" not in again["paper"]


def test_an_unusable_plan_fails_the_build_after_one_retry(session: Session, skill: Skill):
    build, job = new_build(session)
    runner = FakeRunner(json.dumps({"summary": "too thin"}))

    with pytest.raises(PermanentJobError):
        planning.plan_build(session, job, runner=runner, skill=skill)

    session.refresh(build)
    assert len(runner.calls) == 2
    assert build.state is BuildState.FAILED and build.stop_reason is StopReason.ERROR
    assert build.error and "usable plan" in build.error


def test_a_runner_error_fails_the_build_only_on_the_last_attempt(session: Session, skill: Skill):
    build, job = new_build(session)

    def broken(prompt: str) -> str:
        raise RunnerError("claude exited 1")

    for attempts, expected in ((1, BuildState.PLANNING), (job.max_attempts, BuildState.FAILED)):
        job.attempts = attempts
        with pytest.raises(RunnerError):
            planning.plan_build(session, job, runner=FakeRunner(broken), skill=skill)
        session.refresh(build)
        assert build.state is expected


def test_a_deleted_or_moved_on_build_is_skipped(session: Session, skill: Skill):
    build, job = new_build(session)
    build.state = BuildState.PLANNED
    session.add(build)
    session.commit()
    runner = FakeRunner("{}")

    moved = planning.plan_build(session, job, runner=runner, skill=skill)
    service.delete_build(session, build)
    gone = planning.plan_build(session, job, runner=runner, skill=skill)

    assert moved.state is JobState.SKIPPED and gone.state is JobState.SKIPPED
    assert runner.calls == []


def test_the_handler_is_registered(session: Session):
    import app.pipeline.handlers.builds_plan  # noqa: F401  (registers on import)

    assert get_handler(JobKind.BUILD_PLAN) is not None


def test_the_input_carries_references_notes_workflow_and_only_the_kept_sections(
    session: Session,
):
    from tests.papers.conftest import make_paper

    shelf = make_paper(session, "Dense Passage Retrieval")
    build, _ = new_build(session, options={
        "context": {"sections": ["tldr"], "notes": "Keep it in NumPy."},
        "references": [
            {"kind": "url", "url": "https://x.org/post", "title": "A post", "note": "the diagram"},
            {"kind": "shelf", "document_id": str(shelf.id), "title": "DPR"},
        ],
        "advanced": {"tests": "smoke", "commit_style": "small", "license": "MIT"},
    })  # fmt: skip
    paper = session.get(Document, build.document_id)
    assert paper is not None

    got = planning.plan_input(session, build, paper)

    assert "## TL;DR" in got["paper"] and "## Claims" not in got["paper"]
    assert got["notes"] == "Keep it in NumPy."
    assert got["references"] == [
        {"title": "A post", "url": "https://x.org/post", "note": "the diagram", "kind": "url"},
        {"title": "DPR", "url": None, "note": None, "kind": "shelf",
         "paper": "Dense Passage Retrieval"},
    ]  # fmt: skip
    assert got["workflow"] == {"commit_style": "small", "tests": "smoke", "license": "MIT"}


def test_plan_model_pins_the_planners_model(session: Session):
    from app.models.enums import Tier

    auto, _ = new_build(session)
    pinned, _ = new_build(session, options={"advanced": {"plan_model": "haiku"}})

    assert planning.plan_runner(auto) is None
    runner = planning.plan_runner(pinned)
    assert runner is not None
    argv = runner.argv(Tier.REASON)  # type: ignore[attr-defined]
    assert argv[argv.index("--model") + 1] == "haiku"

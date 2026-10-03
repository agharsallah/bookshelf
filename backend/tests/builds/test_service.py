"""The build state machine: layering of options and stops, transitions, jobs, runner helpers."""

import pytest
from sqlmodel import Session, select

from app.builds import service
from app.core.errors import ConflictError
from app.models import Build, Document, Job
from app.models.build import BuildState, BuildVisibility, StopReason
from app.models.enums import JobKind, Origin, Review
from app.schemas.build_options import BuildAdvanced
from app.schemas.builds import (
    BuildCreate,
    BuildOptionsInput,
    BuildPlan,
    BuildStopsInput,
)
from app.services import app_settings
from app.services.errors import InvalidInputError
from tests.builds.factories import GOAL, FakeProbe, known_paper, valid_plan


def create(session: Session, paper: Document, **body: object) -> Build:
    return service.create_build(
        session, paper, BuildCreate.model_validate({"goal": GOAL, **body}), probe=FakeProbe()
    )


def planned(session: Session, **body: object) -> Build:
    build = create(session, known_paper(session), **body)
    build.state, build.plan, build.plan_origin = BuildState.PLANNED, valid_plan(), Origin.SKILL
    session.add(build)
    session.commit()
    return build


def jobs(session: Session, kind: JobKind) -> list[Job]:
    return list(session.exec(select(Job).where(Job.kind == kind)))


def test_create_queues_the_plan_with_defaults_filled(session: Session):
    paper = known_paper(session)
    build = create(session, paper)

    assert build.state is BuildState.PLANNING
    (job,) = jobs(session, JobKind.BUILD_PLAN)
    assert build.plan_job_id == job.id and job.payload == {"build_id": str(build.id)}
    assert build.options == {
        "repo_name": f"{paper.slug}-build", "visibility": "private", "owner": None,
        "claude_attribution": False, "link_paper": True, "stack": None, "allow_web": False,
        "context": {"sections": None, "notes": None}, "references": [],
        "advanced": BuildAdvanced().model_dump(mode="json"),
    }  # fmt: skip
    assert build.stops == {"max_minutes": 90, "max_commits": 30, "max_budget_usd": None,
                           "done_when": []}  # fmt: skip


def test_the_form_overrides_the_preset_which_overrides_the_settings(session: Session):
    app_settings.set_build_defaults(session, {"owner": "acme", "max_commits": 12,
                                              "visibility": BuildVisibility.PUBLIC})  # fmt: skip
    build = create(session, known_paper(session), preset="minimal-implementation",
                   stops={"max_minutes": 45}, options={"link_paper": False})  # fmt: skip

    preset = service.load_agent().preset("minimal-implementation")
    assert preset is not None
    assert build.preset == "minimal-implementation"
    assert build.options["owner"] == "acme" and build.options["visibility"] == "public"
    assert build.options["link_paper"] is False and build.options["stack"] == preset.stack
    assert build.stops["max_minutes"] == 45
    assert build.stops["max_commits"] == preset.stops.get("max_commits", 12)


def test_an_unknown_preset_is_refused(session: Session):
    with pytest.raises(InvalidInputError):
        create(session, known_paper(session), preset="no-such-preset")


def test_a_preflight_error_refuses_the_build_with_the_checks(session: Session):
    paper = known_paper(session, card=None)
    body = BuildCreate(goal=GOAL)

    with pytest.raises(ConflictError) as raised:
        service.create_build(session, paper, body, probe=FakeProbe(missing=["git"]))

    assert {d["key"] for d in raised.value.details} == {"git_cli", "git_identity", "paper_card"}
    assert all(d["fix"] for d in raised.value.details)
    assert session.exec(select(Build)).first() is None


def test_editing_the_plan_marks_it_human_and_only_when_planned(session: Session):
    build = planned(session)
    plan = BuildPlan.model_validate({**valid_plan(), "summary": "A smaller thing, hand made."})

    service.update_plan(session, build, plan)

    assert build.plan_origin is Origin.HUMAN and build.plan["summary"].startswith("A smaller")
    build.state = BuildState.BUILDING
    with pytest.raises(ConflictError):
        service.update_plan(session, build, plan)


def test_replan_keeps_the_plan_and_queues_planning_again(session: Session):
    build = planned(session)
    first_job = build.plan_job_id
    session.get(Job, first_job).state = "done"  # type: ignore[union-attr]
    session.commit()

    service.replan(session, build, "Fewer files, please.")

    assert build.state is BuildState.PLANNING and build.plan_feedback == "Fewer files, please."
    assert build.plan is not None and build.plan_job_id != first_job


def test_approve_takes_the_plans_repo_name_unless_you_typed_one(session: Session):
    suggested = planned(session)
    typed = planned(session, options={"repo_name": "my-repo"})

    service.approve(session, suggested, probe=FakeProbe())
    service.approve(session, typed, BuildOptionsInput(stack="JAX"), BuildStopsInput(max_commits=5),
                    probe=FakeProbe())  # fmt: skip

    assert suggested.options["repo_name"] == valid_plan()["repo_name"]
    assert typed.options["repo_name"] == "my-repo" and typed.options["stack"] == "JAX"
    assert typed.stops["max_commits"] == 5
    assert suggested.state is BuildState.BUILDING and suggested.run_job_id is not None
    runs = jobs(session, JobKind.BUILD_RUN)
    assert {j.payload["build_id"] for j in runs} == {str(suggested.id), str(typed.id)}


def test_approve_needs_a_planned_build_and_a_passing_preflight(session: Session):
    build = planned(session)
    with pytest.raises(ConflictError):
        service.approve(session, build, BuildOptionsInput(visibility=BuildVisibility.PUBLIC),
                        probe=FakeProbe(gh_code=1))  # fmt: skip
    assert build.state is BuildState.PLANNED

    build.state = BuildState.PLANNING
    with pytest.raises(ConflictError):
        service.approve(session, build, probe=FakeProbe())


def test_stop_then_finish_then_continue(session: Session):
    build = planned(session)
    service.approve(session, build, probe=FakeProbe())

    service.request_stop(session, build)
    assert build.state is BuildState.STOPPING and build.stop_requested
    with pytest.raises(ConflictError):
        service.delete_build(session, build)

    service.finish(session, build, state=BuildState.STOPPED, stop_reason=StopReason.USER)
    assert build.finished_at is not None and not build.stop_requested

    service.continue_build(session, build, goal="Add a training loop.",
                           stops=BuildStopsInput(max_minutes=20))  # fmt: skip
    assert build.state is BuildState.BUILDING and build.stops["max_minutes"] == 20
    resumed = session.get(Job, build.run_job_id)
    assert resumed is not None and resumed.payload["resume"] is True
    assert resumed.payload["goal"] == "Add a training loop."


@pytest.mark.parametrize("state", [BuildState.PLANNING, BuildState.PLANNED, BuildState.FAILED])
def test_only_a_finished_build_continues_and_only_a_running_one_stops(
    session: Session, state: BuildState
):
    build = planned(session)
    build.state = state
    with pytest.raises(ConflictError):
        service.continue_build(session, build, goal=None, stops=None)
    with pytest.raises(ConflictError):
        service.request_stop(session, build)


def test_progress_keeps_the_last_events_and_each_commit_once(session: Session):
    build = planned(session)
    events = [{"at": "2026-10-03T10:00:00Z", "kind": "text", "text": f"e{i}"} for i in range(150)]
    commit = {"sha": "abc", "subject": "feat: x", "at": "2026-10-03T10:00:00Z"}

    service.record_progress(session, build, events=events, commits=[commit], cost_usd=0.5)
    service.record_progress(session, build, events=events, commits=[commit], cost_usd=1.25)

    assert len(build.events) == service.MAX_EVENTS and build.events[-1]["text"] == "e149"
    assert build.commits == [commit] and build.cost_usd == 1.25


def test_finish_needs_a_final_state_and_keeps_the_report(session: Session):
    build = planned(session)
    with pytest.raises(ValueError, match="final state"):
        service.finish(session, build, state=BuildState.BUILDING, stop_reason=None)

    report = {"status": "goal_reached", "done": ["all"], "not_done": [], "next_steps": [],
              "run_it": "uv run python -m x"}  # fmt: skip
    service.finish(session, build, state=BuildState.DONE, stop_reason=StopReason.GOAL_REACHED,
                   report=report)  # fmt: skip
    assert build.report == report and build.stop_reason is StopReason.GOAL_REACHED


def test_delete_and_list_newest_first(session: Session):
    paper = known_paper(session)
    first, second = create(session, paper), create(session, paper)

    assert [b.id for b in service.list_builds(session, paper.id)] == [second.id, first.id]
    service.delete_build(session, first)
    assert [b.id for b in service.list_builds(session, paper.id)] == [second.id]


def test_a_draft_card_still_builds(session: Session):
    build = create(session, known_paper(session, card=Review.DRAFT))

    assert build.state is BuildState.PLANNING

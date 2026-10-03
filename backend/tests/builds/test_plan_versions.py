"""Plan versions (docs/BUILDS.md §7b): drafts, replans and edits append; a restore points."""

import json
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlmodel import Session

from app.builds import planning, plans, service
from app.builds.seed import plan_heading
from app.builds.workspace_files import seed_files
from app.core.config import get_settings
from app.core.errors import ConflictError, NotFoundError
from app.db.migrate import MIGRATIONS_DIR
from app.models import Build, Document, Job
from app.models.build import BuildState
from app.models.enums import Origin
from app.pipeline.runner import FakeRunner
from app.pipeline.skills import Skill, load_skill
from app.schemas.builds import BuildCreate, BuildPlan
from tests.builds.factories import GOAL, FakeProbe, known_paper, valid_plan
from tests.conftest import AUTH

API = "/api/v1"


@pytest.fixture
def skill() -> Skill:
    return load_skill(get_settings().skills_dir / planning.SKILL_NAME)


def plan_with(summary: str) -> dict[str, Any]:
    """The example plan with its summary starting `summary` (the schema wants 20+ chars)."""
    return {**valid_plan(), "summary": f"{summary} Then the gated reader, step by step."}


def draft(session: Session, build: Build, skill: Skill, summary: str) -> Build:
    """Run the queued `build_plan` job with a planner that answers `summary`."""
    job = session.get(Job, build.plan_job_id)
    assert job is not None
    runner = FakeRunner(json.dumps(plan_with(summary)), model="claude-test")
    planning.plan_build(session, job, runner=runner, skill=skill)
    session.refresh(build)
    return build


def planned_build(session: Session, skill: Skill) -> Build:
    paper = known_paper(session)
    body = BuildCreate.model_validate({"goal": GOAL})
    build = service.create_build(session, paper, body, probe=FakeProbe())
    return draft(session, build, skill, "First draft.")


def edit(session: Session, build: Build, summary: str) -> Build:
    return service.update_plan(session, build, BuildPlan.model_validate(plan_with(summary)))


def paper_of(session: Session, build: Build) -> Document:
    paper = session.get(Document, build.document_id)
    assert paper is not None
    return paper


def history(session: Session, build: Build) -> list[tuple[int, Origin, int | None, str | None]]:
    """(version, origin, based_on, feedback), oldest first."""
    rows = reversed(plans.list_plan_versions(session, build))
    return [(r.version, r.origin, r.based_on, r.feedback) for r in rows]


# --- the service --------------------------------------------------------------------------


def test_draft_replan_and_edit_each_append_a_version(session: Session, skill: Skill):
    build = planned_build(session, skill)
    service.replan(session, build, "Fewer files.")
    draft(session, build, skill, "Second draft.")
    edit(session, build, "My edit.")

    assert history(session, build) == [
        (1, Origin.SKILL, None, None),
        (2, Origin.SKILL, 1, "Fewer files."),
        (3, Origin.HUMAN, 2, None),
    ]
    assert build.plan_version == 3 and build.plan_origin is Origin.HUMAN
    assert build.plan is not None and build.plan["summary"].startswith("My edit.")
    first = plans.list_plan_versions(session, build)[-1]
    assert first.model == "claude-test" and first.plan["summary"].startswith("First draft.")


def test_the_replan_input_still_carries_the_current_plan(session: Session, skill: Skill):
    build = planned_build(session, skill)
    edit(session, build, "My edit.")
    service.replan(session, build, "Shorter.")

    given = planning.plan_input(session, build, paper_of(session, build))

    assert (
        given["previous_plan"]["summary"].startswith("My edit.") and given["feedback"] == "Shorter."
    )


def test_restore_moves_the_current_plan_without_a_new_row(session: Session, skill: Skill):
    build = planned_build(session, skill)
    edit(session, build, "My edit.")

    plans.restore_plan(session, build, 1)

    assert build.plan_version == 1 and build.plan_origin is Origin.SKILL
    assert build.plan is not None and build.plan["summary"].startswith("First draft.")
    assert plans.versions_count(session, build) == 2


def test_an_edit_after_a_restore_is_based_on_the_restored_version(session: Session, skill: Skill):
    build = planned_build(session, skill)
    edit(session, build, "Edit one.")
    edit(session, build, "Edit two.")
    plans.restore_plan(session, build, 1)

    edit(session, build, "Edit from v1.")

    assert history(session, build)[-1] == (4, Origin.HUMAN, 1, None)
    assert build.plan_version == 4


def test_a_replan_after_a_restore_is_based_on_the_restored_version(session: Session, skill: Skill):
    build = planned_build(session, skill)
    edit(session, build, "Edit one.")
    plans.restore_plan(session, build, 1)
    service.replan(session, build, "Again.")

    draft(session, build, skill, "Redraft.")

    assert history(session, build)[-1] == (3, Origin.SKILL, 1, "Again.")


def test_restore_is_only_while_planned_and_only_a_known_version(session: Session, skill: Skill):
    build = planned_build(session, skill)

    with pytest.raises(NotFoundError):
        plans.restore_plan(session, build, 7)
    service.replan(session, build, "Again.")
    with pytest.raises(ConflictError):
        plans.restore_plan(session, build, 1)


# --- PLAN.md ------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("version", "origin", "based_on", "feedback", "heading"),
    [
        (1, "skill", None, None, "Plan v1 (drafted)"),
        (2, "skill", 1, "Fewer\n files.", 'Plan v2 (replanned from v1: "Fewer files.")'),
        (2, "skill", 1, None, "Plan v2 (replanned from v1)"),
        (3, "human", 2, None, "Plan v3 (edited by you, from v2)"),
    ],
)
def test_plan_heading_names_the_version(
    version: int, origin: str, based_on: int | None, feedback: str | None, heading: str
):
    assert plan_heading(version, origin=origin, based_on=based_on, feedback=feedback) == heading


def test_plan_heading_cuts_long_feedback_at_120_characters():
    heading = plan_heading(2, origin="skill", based_on=1, feedback="x" * 300)

    assert heading == f'Plan v2 (replanned from v1: "{"x" * 119}…")'


def test_the_seeded_plan_md_names_the_current_version(session: Session, skill: Skill):
    build = planned_build(session, skill)
    edit(session, build, "My edit.")

    files = {f.path: f.content for f in seed_files(session, build, author=None, fetch=None).files}

    assert "_Plan v2 (edited by you, from v1)_" in files["docs/PLAN.md"]
    assert "My edit." in files["docs/PLAN.md"]


# --- the backfill -------------------------------------------------------------------------


def test_the_backfill_makes_an_existing_plan_v1(session: Session):
    """The migration's backfill statements, run over a build planned before versions."""
    paper = known_paper(session)
    build = Build(document_id=paper.id, goal=GOAL, options={}, stops={}, plan=valid_plan(),
                  plan_origin=Origin.HUMAN, state=BuildState.PLANNED)  # fmt: skip
    bare = Build(document_id=paper.id, goal=GOAL, options={}, stops={})
    session.add_all([build, bare])
    session.commit()
    sql = (MIGRATIONS_DIR / "20261003180000_build_plan_versions.sql").read_text("utf-8")
    backfill = sql.split("-- Backfill", 1)[1].split("\n", 1)[1].split("-- Supabase", 1)[0]

    for statement in filter(str.strip, backfill.split(";")):
        session.execute(text(statement))
    session.commit()
    session.refresh(build)
    session.refresh(bare)

    assert build.plan_version == 1 and bare.plan_version is None
    assert history(session, build) == [(1, Origin.HUMAN, None, None)]
    assert plans.versions_count(session, bare) == 0


# --- the endpoints ------------------------------------------------------------------------


def test_the_versions_endpoint_lists_newest_first_and_marks_current(
    client: TestClient, session: Session, skill: Skill
):
    build = planned_build(session, skill)
    edit(session, build, "My edit.")
    plans.restore_plan(session, build, 1)

    listed = client.get(f"{API}/builds/{build.id}/plans")
    one = client.get(f"{API}/builds/{build.id}").json()

    assert listed.status_code == 200
    rows = listed.json()
    assert [(r["version"], r["origin"], r["based_on"], r["current"]) for r in rows] == [
        (2, "human", 1, False),
        (1, "skill", None, True),
    ]
    assert rows[1]["model"] == "claude-test" and rows[1]["plan"]["summary"].startswith(
        "First draft."
    )
    assert (one["plan_version"], one["plan_versions_count"]) == (1, 2)


def test_restore_endpoint_needs_the_key_and_answers_409_and_404(
    client: TestClient, session: Session, skill: Skill
):
    build = planned_build(session, skill)
    edit(session, build, "My edit.")
    url = f"{API}/builds/{build.id}/plans"

    unauthorised = client.post(f"{url}/1/restore")
    unknown = client.post(f"{url}/9/restore", headers=AUTH)
    restored = client.post(f"{url}/1/restore", headers=AUTH)
    service.replan(session, session.get(Build, build.id) or build, "Again.")
    conflict = client.post(f"{url}/2/restore", headers=AUTH)

    assert unauthorised.status_code == 401
    assert unknown.status_code == 404
    assert restored.status_code == 200
    assert (restored.json()["plan_version"], restored.json()["plan_versions_count"]) == (1, 2)
    assert restored.json()["plan"]["summary"].startswith("First draft.")
    assert conflict.status_code == 409


def test_the_list_counts_each_builds_versions(client: TestClient, session: Session, skill: Skill):
    build = planned_build(session, skill)
    edit(session, build, "My edit.")
    paper = paper_of(session, build)
    other = service.create_build(session, paper, BuildCreate.model_validate({"goal": GOAL}),
                                 probe=FakeProbe())  # fmt: skip

    rows = client.get(f"{API}/papers/{paper.slug}/builds").json()

    counts = {r["id"]: (r["plan_version"], r["plan_versions_count"]) for r in rows}
    assert counts == {str(build.id): (2, 2), str(other.id): (None, 0)}


def test_versions_of_an_unknown_build_are_a_404(client: TestClient):
    response = client.get(f"{API}/builds/00000000-0000-0000-0000-000000000000/plans")

    assert response.status_code == 404

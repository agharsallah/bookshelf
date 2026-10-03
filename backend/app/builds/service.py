"""The build state machine (docs/BUILDS.md §2, §4).

    create ─► planning ─(build_plan)─► planned ─approve─► building ─► done | stopped | failed
                            ▲    replan │  ▲ edit plan              │ stop: stopping ─► stopped
                            └───────────┘                          continue (done | stopped)

Each transition checks the state it leaves (`ConflictError` otherwise) and queues its job in
the same commit. Options and stops are filled in layers: the form, then the preset, then the
settings (`app.builds.options`, preflight included). `record_progress` and `finish` are what
the runner calls while and after it runs.
"""

import uuid
from collections.abc import Iterable, Mapping
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlmodel import Session, col, select

from app.builds.agents import AgentPackage, load_agent
from app.builds.github import GitHub, web_url
from app.builds.options import (
    check_shelf_references,
    checked_options,
    merge_fields,
    merge_options,
    resolve_options,
    resolve_stops,
    suggested_repo_name,
)
from app.builds.plans import record_plan
from app.builds.preflight import Probe
from app.core.config import get_settings
from app.core.errors import ConflictError, NotFoundError
from app.jobs.queue import JobSpec
from app.models import Build, Document
from app.models.build import BuildState, StopReason
from app.models.enums import JobKind, Origin
from app.schemas.builds import (
    BuildCreate,
    BuildOptionsInput,
    BuildPlan,
    BuildStops,
    BuildStopsInput,
)
from app.services import app_settings
from app.services.errors import InvalidInputError

MAX_EVENTS = 200
FINAL_STATES = (BuildState.DONE, BuildState.STOPPED, BuildState.FAILED)


def _now() -> datetime:
    return datetime.now(UTC)


def _require(build: Build, *states: BuildState, action: str) -> None:
    if build.state not in states:
        allowed = " or ".join(s.value for s in states)
        raise ConflictError(
            f"Cannot {action} a build that is {build.state.value} (only when {allowed})."
        )


# --- reading ------------------------------------------------------------------------------


def get_build(session: Session, build_id: uuid.UUID) -> Build:
    build = session.get(Build, build_id)
    if build is None:
        raise NotFoundError(f"Build {build_id} does not exist.")
    return build


def list_builds(session: Session, document_id: uuid.UUID) -> list[Build]:
    """A paper's builds, newest first."""
    return list(
        session.exec(
            select(Build)
            .where(Build.document_id == document_id)
            .order_by(col(Build.created_at).desc())
        )
    )


# --- jobs ---------------------------------------------------------------------------------


def _queue(session: Session, build: Build, kind: JobKind, payload: dict[str, Any]) -> uuid.UUID:
    """Queue `kind` for `build`, committing the build with it."""
    # Imported here: `services.jobs` sits in an import cycle (audio ↔ documents) that only
    # resolves when something else loaded it first, and the job runners import this module.
    from app.services.jobs import enqueue_or_live

    # One key per transition: the state checks already refuse a double approve, and a
    # continue must not be folded into the run job that is still finishing.
    key = f"build:{build.id}:{kind.value}:{uuid.uuid4().hex[:12]}"
    job, _ = enqueue_or_live(
        session,
        JobSpec(kind=kind, document_id=build.document_id, input_hash=key,
                payload={"build_id": str(build.id), **payload}),
    )  # fmt: skip
    return job.id


def _save(session: Session, build: Build) -> Build:
    session.add(build)
    session.commit()
    session.refresh(build)
    return build


# --- transitions --------------------------------------------------------------------------


def create_build(
    session: Session,
    paper: Document,
    body: BuildCreate,
    *,
    probe: Probe | None = None,
    agent: AgentPackage | None = None,
    github: GitHub | None = None,
) -> Build:
    """Preflight, then a `planning` build with its `build_plan` job. `ConflictError` with the
    failing checks in `details` when preflight finds an error."""
    agent = agent or load_agent()
    preset = agent.preset(body.preset)
    if body.preset and preset is None:
        raise InvalidInputError(f"Unknown preset {body.preset!r}.", field="body.preset")
    defaults = app_settings.build_defaults(session)
    options = resolve_options(body.options, preset, defaults,
                              repo_name=suggested_repo_name(paper, body.preset))  # fmt: skip
    check_shelf_references(session, options)
    options = checked_options(session, paper, options, probe=probe, github=github)
    build = Build(
        document_id=paper.id,
        agent=agent.name,
        preset=preset.key if preset else None,
        goal=body.goal,
        options=options.model_dump(mode="json"),
        stops=resolve_stops(body.stops, preset, defaults).model_dump(mode="json"),
        repo_url=web_url(options.target.repo) if options.target.repo else None,
    )
    session.add(build)
    session.flush()
    build.plan_job_id = _queue(session, build, JobKind.BUILD_PLAN, {})
    return _save(session, build)


def update_plan(session: Session, build: Build, plan: BuildPlan) -> Build:
    """Your edit becomes a new plan version, based on the one you edited (§7b)."""
    _require(build, BuildState.PLANNED, action="edit the plan of")
    record_plan(session, build, plan.model_dump(mode="json"), origin=Origin.HUMAN,
                based_on=build.plan_version)  # fmt: skip
    return _save(session, build)


def replan(session: Session, build: Build, feedback: str) -> Build:
    """Plan again with your feedback; the current plan goes to the planner as `previous_plan`.
    `plan_version` stays put while it plans, so the draft records it as its `based_on`."""
    _require(build, BuildState.PLANNED, BuildState.FAILED, action="replan")
    build.state, build.plan_feedback, build.error = BuildState.PLANNING, feedback, None
    build.stop_reason = None
    session.add(build)
    build.plan_job_id = _queue(session, build, JobKind.BUILD_PLAN, {})
    return _save(session, build)


def approve(
    session: Session,
    build: Build,
    options: BuildOptionsInput | None = None,
    stops: BuildStopsInput | None = None,
    *,
    probe: Probe | None = None,
    github: GitHub | None = None,
) -> Build:
    """Start building. A repo name never typed by you takes the plan's suggestion."""
    _require(build, BuildState.PLANNED, action="approve")
    if build.plan is None:
        raise ConflictError("This build has no plan to approve.")
    paper = session.get(Document, build.document_id)
    assert paper is not None  # noqa: S101 - the foreign key cascades
    new_options = merge_options(build.options, options, repo_name=build.plan.get("repo_name"))
    if (
        not new_options.target.existing
        and not (options and options.repo_name)
        and new_options.repo_name == suggested_repo_name(paper, build.preset)
    ):
        repo_name = build.plan.get("repo_name") or new_options.repo_name
        new_options = new_options.model_copy(update={"repo_name": repo_name})
    check_shelf_references(session, new_options)
    new_stops = BuildStops.model_validate(merge_fields(build.stops, stops))
    new_options = checked_options(session, paper, new_options, probe=probe, github=github,
                           own=build.workspace is not None)  # fmt: skip
    build.options = new_options.model_dump(mode="json")
    build.stops = new_stops.model_dump(mode="json")
    _start(build)
    session.add(build)
    build.run_job_id = _queue(session, build, JobKind.BUILD_RUN, {})
    return _save(session, build)


def _start(build: Build) -> None:
    build.state, build.stop_reason, build.stop_requested = BuildState.BUILDING, None, False
    build.error, build.finished_at = None, None


def request_stop(session: Session, build: Build) -> Build:
    """Ask the watcher to stop the run; it pushes what is committed, then `finish`es."""
    _require(build, BuildState.BUILDING, action="stop")
    build.state, build.stop_requested = BuildState.STOPPING, True
    return _save(session, build)


def continue_build(
    session: Session, build: Build, *, goal: str | None, stops: BuildStopsInput | None
) -> Build:
    """Resume the same session in the same repo, with new stops and maybe a new goal."""
    _require(build, BuildState.DONE, BuildState.STOPPED, action="continue")
    build.stops = BuildStops.model_validate(merge_fields(build.stops, stops)).model_dump(
        mode="json"
    )
    _start(build)
    session.add(build)
    build.run_job_id = _queue(session, build, JobKind.BUILD_RUN, {"resume": True, "goal": goal})
    return _save(session, build)


def delete_build(session: Session, build: Build) -> None:
    """Forget a build; its workspace and GitHub repo are left alone, but a local target's
    worktree, if one is still attached, is removed (its branch stays)."""
    from app.builds.existing_repo import release_workspace

    if build.state in (BuildState.BUILDING, BuildState.STOPPING):
        raise ConflictError(f"Cannot delete a build that is {build.state.value}: stop it first.")
    settings = get_settings()
    repo = Path(settings.build_workspace).expanduser() / str(build.id) / "repo"
    release_workspace(build, repo, git_bin=settings.git_bin)
    session.delete(build)
    session.commit()


# --- what the runner reports --------------------------------------------------------------


def record_progress(
    session: Session,
    build: Build,
    *,
    events: Iterable[Mapping[str, Any]] | None = None,
    commits: Iterable[Mapping[str, Any]] | None = None,
    cost_usd: float | None = None,
) -> Build:
    """Append events (the last `MAX_EVENTS` kept) and new commits (by sha); set the cost.
    Reloads first, so a stop asked meanwhile shows in `build.stop_requested`."""
    session.refresh(build)
    if events:
        build.events = [*build.events, *(dict(e) for e in events)][-MAX_EVENTS:]
    if commits:
        seen = {c.get("sha") for c in build.commits}
        fresh = [dict(c) for c in commits if c.get("sha") not in seen]
        build.commits = [*build.commits, *fresh]
    if cost_usd is not None:
        build.cost_usd = cost_usd
    return _save(session, build)


def finish(
    session: Session,
    build: Build,
    *,
    state: BuildState,
    stop_reason: StopReason | None,
    report: Mapping[str, Any] | None = None,
    error: str | None = None,
) -> Build:
    """End a run: `done`, `stopped` or `failed`."""
    if state not in FINAL_STATES:
        raise ValueError(f"finish needs a final state, not {state.value}")
    session.refresh(build)
    build.state, build.stop_reason, build.stop_requested = state, stop_reason, False
    build.finished_at = _now()
    if report is not None:
        build.report = dict(report)
    if error is not None:
        build.error = error
    return _save(session, build)

"""The build state machine (docs/BUILDS.md §2, §4).

    create ─► planning ─(build_plan)─► planned ─approve─► building ─► done | stopped | failed
                            ▲    replan │  ▲ edit plan              │ stop: stopping ─► stopped
                            └───────────┘                          continue (done | stopped)

Each transition checks the state it leaves (`ConflictError` otherwise) and queues its job in
the same commit. Options and stops are filled in layers: the form, then the preset, then the
settings (`app_settings.build_defaults`). `record_progress` and `finish` are what the runner
calls while and after it runs.
"""

import re
import uuid
from collections.abc import Iterable, Mapping
from dataclasses import asdict
from datetime import UTC, datetime
from typing import Any

from pydantic import ValidationError
from sqlmodel import Session, col, select

from app.builds.agents import AgentPackage, Preset, load_agent
from app.builds.plans import record_plan
from app.builds.preflight import Probe, preflight
from app.core.config import get_settings
from app.core.errors import ConflictError, NotFoundError
from app.jobs.queue import JobSpec
from app.models import Build, Document
from app.models.build import BuildState, BuildVisibility, StopReason
from app.models.enums import Genre, JobKind, Origin
from app.schemas.build_options import BuildAdvanced
from app.schemas.builds import (
    BuildCreate,
    BuildOptions,
    BuildOptionsInput,
    BuildPlan,
    BuildStops,
    BuildStopsInput,
)
from app.services import app_settings
from app.services.errors import InvalidInputError

MAX_EVENTS = 200
FINAL_STATES = (BuildState.DONE, BuildState.STOPPED, BuildState.FAILED)
_NOT_NAME = re.compile(r"[^a-z0-9._-]+")


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


# --- options and stops --------------------------------------------------------------------


def suggested_repo_name(document: Document, preset: str | None) -> str:
    """The name a build gets until its plan suggests one: `<paper slug>[-<preset>]`."""
    raw = f"{document.slug}-{preset}" if preset else f"{document.slug}-build"
    return _NOT_NAME.sub("-", raw.lower()).strip("-.")[:100] or "paper-build"


def resolve_options(
    given: BuildOptionsInput, preset: Preset | None, defaults: app_settings.BuildDefaults,
    *, repo_name: str,
) -> BuildOptions:  # fmt: skip
    """The form's options over the preset's stack over the settings. A `local` build
    whose pull request delivery came from the settings (not the form) pushes nowhere, so it
    falls back to `push_main`; one asked for explicitly is refused by the schema."""
    visibility = given.visibility or defaults.visibility
    advanced = {**asdict(defaults.advanced),
                **(given.advanced.changes() if given.advanced else {})}  # fmt: skip
    if visibility is BuildVisibility.LOCAL:
        advanced["delivery"] = "push_main"
    return _validated(
        repo_name=given.repo_name or repo_name,
        visibility=visibility,
        owner=given.owner if given.owner is not None else defaults.owner,
        claude_attribution=_first(given.claude_attribution, defaults.claude_attribution),
        link_paper=_first(given.link_paper, defaults.link_paper),
        stack=given.stack or (preset.stack if preset else None),
        allow_web=_first(given.allow_web, False),
        context=given.context.changes() if given.context else {},
        references=[r.model_dump(mode="json") for r in given.references or []],
        advanced=BuildAdvanced.model_validate(advanced).model_dump(mode="json"),
    )


def _validated(**fields: Any) -> BuildOptions:
    """`BuildOptions` from merged layers; a combination that does not hold is a `422`."""
    try:
        return BuildOptions.model_validate(fields)
    except ValidationError as exc:
        problems = "; ".join(str(e["msg"]).removeprefix("Value error, ") for e in exc.errors())
        raise InvalidInputError(f"Invalid build options: {problems}", field="body.options") from exc


def merge_options(current: Mapping[str, Any], given: BuildOptionsInput | None) -> BuildOptions:
    """`current` (stored options) with what `given` sends: plain fields replaced when sent,
    `context` and `advanced` merged key by key, `references` replaced as a list."""
    if given is None:
        return _validated(**current)
    changes = given.changes()
    merged = {**current, **{k: v for k, v in changes.items() if k not in _NESTED}}
    for key in _NESTED:
        if key in changes:
            merged[key] = {**(current.get(key) or {}), **changes[key]}
    return _validated(**merged)


_NESTED = ("context", "advanced")


def check_shelf_references(session: Session, options: BuildOptions) -> None:
    """Every shelf reference names a paper on the shelf (`422` otherwise)."""
    for ref in options.references:
        if ref.kind != "shelf":
            continue
        paper = session.get(Document, ref.document_id)
        if paper is None or paper.genre is not Genre.PAPER:
            raise InvalidInputError(
                f"Reference {ref.title!r}: no paper {ref.document_id} on the shelf.",
                field="body.options.references",
            )


def resolve_stops(
    given: BuildStopsInput, preset: Preset | None, defaults: app_settings.BuildDefaults
) -> BuildStops:
    """The form's stops over the preset's over the settings; minutes capped by the hard cap."""
    from_preset = preset.stops if preset else {}
    minutes = _first(given.max_minutes, from_preset.get("max_minutes"), defaults.max_minutes)
    return BuildStops(
        max_minutes=min(minutes, get_settings().build_hard_cap_minutes),
        max_commits=_first(given.max_commits, from_preset.get("max_commits"),
                           defaults.max_commits),
        max_budget_usd=_first(given.max_budget_usd, from_preset.get("max_budget_usd"),
                              defaults.max_budget_usd),
        done_when=_first(given.done_when, from_preset.get("done_when"), []),
    )  # fmt: skip


def _first(*values: Any) -> Any:
    return next((v for v in values if v is not None), None)


def _merge(current: Mapping[str, Any], override: Any) -> dict[str, Any]:
    """`current` with every field the override sets (a pydantic model or None)."""
    return {**current, **(override.model_dump(exclude_none=True) if override else {})}


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
    check = preflight(session, paper, visibility=options.visibility, probe=probe)
    if not check.ready:
        raise ConflictError(
            "This build cannot start yet: " + "; ".join(c.message for c in check.errors),
            [asdict(c) for c in check.errors],
        )
    build = Build(
        document_id=paper.id,
        agent=agent.name,
        preset=preset.key if preset else None,
        goal=body.goal,
        options=options.model_dump(mode="json"),
        stops=resolve_stops(body.stops, preset, defaults).model_dump(mode="json"),
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
) -> Build:
    """Start building. A repo name never typed by you takes the plan's suggestion."""
    _require(build, BuildState.PLANNED, action="approve")
    if build.plan is None:
        raise ConflictError("This build has no plan to approve.")
    paper = session.get(Document, build.document_id)
    assert paper is not None  # noqa: S101 - the foreign key cascades
    new_options = merge_options(build.options, options)
    if not (options and options.repo_name) and new_options.repo_name == suggested_repo_name(
        paper, build.preset
    ):
        repo_name = build.plan.get("repo_name") or new_options.repo_name
        new_options = new_options.model_copy(update={"repo_name": repo_name})
    check_shelf_references(session, new_options)
    new_stops = BuildStops.model_validate(_merge(build.stops, stops))
    check = preflight(session, paper, visibility=new_options.visibility, probe=probe)
    if not check.ready:
        raise ConflictError(
            "This build cannot start yet: " + "; ".join(c.message for c in check.errors),
            [asdict(c) for c in check.errors],
        )
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
    build.stops = BuildStops.model_validate(_merge(build.stops, stops)).model_dump(mode="json")
    _start(build)
    session.add(build)
    build.run_job_id = _queue(session, build, JobKind.BUILD_RUN, {"resume": True, "goal": goal})
    return _save(session, build)


def delete_build(session: Session, build: Build) -> None:
    """Forget a build; its workspace and GitHub repo are left alone."""
    if build.state in (BuildState.BUILDING, BuildState.STOPPING):
        raise ConflictError(f"Cannot delete a build that is {build.state.value}: stop it first.")
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

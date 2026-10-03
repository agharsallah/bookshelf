"""`build_plan`: a build's plan from the `plan-build` utility skill (docs/BUILDS.md B1, B2).

    payload.build_id
      → the build (gone, or no longer `planning`: skipped)
      → input {paper: PAPER.md text (the kept sections only), goal, preset {key, label,
               stack} | null, stack, stops, references [{title, url, note, kind}], notes,
               workflow {commit_style, tests, license}, feedback, previous_plan,
               repository {kind, repo, folder, survey_md} | null (§7c: an existing
               repository; `repo` is `owner/name` or the local path)}
      → plan-build (tier `reason`, or `advanced.plan_model`) through the `ModelRunner`,
        validated against its schema, one retry with the problems
      → a new plan version (`plans.record_plan`: origin `skill`, the replan feedback, based
        on the version current when the replan was asked), state `planned`; an unusable
        answer: `failed`

Runs inline like `synthesize_papers`; no transaction is held through the CLI run.
"""

import uuid
from pathlib import Path
from typing import Any

from sqlmodel import Session, col, select

from app.builds.agents import load_agent
from app.builds.context import paper_brief, render_paper_md
from app.builds.github import GhCli, GitHub
from app.builds.launch import options_of
from app.builds.plans import record_plan
from app.builds.targets import Surveyed, survey_for
from app.core.config import Settings, get_settings
from app.db.session import release
from app.jobs.registry import HandlerResult, JobContext, PermanentJobError
from app.models import Build, Document, Job
from app.models.build import BuildState, StopReason
from app.models.enums import JobState, Origin
from app.pipeline.gates import schema_errors
from app.pipeline.handlers.skills import default_runner
from app.pipeline.runner import (
    ClaudeCliRunner,
    ModelRunner,
    OutputError,
    RunnerError,
    UsageLimitError,
    run_structured,
)
from app.pipeline.skills import Skill, load_skill, render_prompt
from app.telemetry.recorder import recorded

SKILL_NAME = "plan-build"


def plan_input(
    session: Session,
    build: Build,
    document: Document,
    *,
    surveyed: Surveyed | None = None,
    github: GitHub | None = None,
) -> dict[str, Any]:
    """What the planner reads. The paper is named (the planner may say what it builds on);
    whether the repo names it is the README's business. For an existing repository the
    survey (`surveyed`, else read now through `github` / git) comes along."""
    preset = load_agent(build.agent).preset(build.preset)
    options = options_of(build)
    target = options.target
    repository = None
    if target.existing:
        if surveyed is None:
            settings = get_settings()
            if target.kind == "github" and github is None:
                github = GhCli(settings.gh_bin)
            surveyed = survey_for(options, github=github, git_bin=settings.git_bin)
        repository = {"kind": target.kind, "repo": target.label, "folder": target.folder,
                      "survey_md": surveyed.markdown}  # fmt: skip
    replanning = _replanning(build)
    paper = render_paper_md(paper_brief(session, document), link_paper=True,
                            sections=options.context.sections)  # fmt: skip
    advanced = options.advanced
    return {
        "paper": paper,
        "goal": build.goal,
        "preset": {"key": preset.key, "label": preset.label, "stack": preset.stack}
        if preset
        else None,
        "stack": options.stack,
        "stops": build.stops,
        "references": _references(session, options.references),
        "notes": (options.context.notes or "").strip() or None,
        "workflow": {
            "commit_style": advanced.commit_style,
            "tests": advanced.tests,
            "license": advanced.license,
        },
        "feedback": build.plan_feedback if replanning else None,
        "previous_plan": build.plan if replanning else None,
        "repository": repository,
    }


def _replanning(build: Build) -> bool:
    """A replan revises a plan with feedback; a first draft (or a retry of one) has neither."""
    return build.plan_feedback is not None and build.plan is not None


def _references(session: Session, refs: list[Any]) -> list[dict[str, Any]]:
    """Title, url (None for a paper on the shelf), note, and whether it is on the shelf."""
    ids = [r.document_id for r in refs if r.document_id is not None]
    titles = dict(session.exec(select(Document.id, Document.title)
                               .where(col(Document.id).in_(ids))).all()) if ids else {}  # fmt: skip
    return [
        {"title": r.title, "url": r.url, "note": r.note, "kind": r.kind,
         **({"paper": titles.get(r.document_id)} if r.kind == "shelf" else {})}
        for r in refs
    ]  # fmt: skip


def plan_runner(build: Build, settings: Settings | None = None) -> ModelRunner | None:
    """A CLI runner pinned to `advanced.plan_model`; None when it is `auto` (the default
    runner, the skill's tier)."""
    settings = settings or get_settings()
    chosen = options_of(build).advanced.plan_model
    if chosen == "auto":
        return None
    pinned = settings.model_copy(
        update={"model_explore": chosen, "model_distil": chosen, "model_reason": chosen}
    )
    return ClaudeCliRunner(settings=pinned)


def _build_id(job: Job) -> uuid.UUID:
    try:
        return uuid.UUID(str((job.payload or {}).get("build_id")))
    except ValueError as exc:
        raise PermanentJobError(f"payload.build_id is not a uuid: {job.payload!r}") from exc


def _fail(session: Session, build_id: uuid.UUID, error: str) -> None:
    build = session.get(Build, build_id)
    if build is not None and build.state is BuildState.PLANNING:
        build.state, build.stop_reason, build.error = BuildState.FAILED, StopReason.ERROR, error
        session.add(build)
        session.commit()


def _skipped(why: str) -> HandlerResult:
    return HandlerResult(state=JobState.SKIPPED, result={"skipped": why})


def plan_build(session: Session, job: Job, *, runner: ModelRunner, skill: Skill) -> HandlerResult:
    """Plan the build `job` names; see the module docstring."""
    build_id = _build_id(job)
    build = session.get(Build, build_id)
    if build is None:
        return _skipped("the build was deleted")
    if build.state is not BuildState.PLANNING:
        return _skipped(f"the build is {build.state.value}")
    document = session.get(Document, build.document_id)
    if document is None:  # pragma: no cover - the foreign key cascades
        return _skipped("the paper was deleted")
    prompt = render_prompt(skill.prompt, plan_input(session, build, document))
    release(session)  # no transaction open through the CLI run(s)
    try:
        run = run_structured(
            runner, prompt, tier=skill.meta.tier,
            validate=lambda output: schema_errors(skill.schema, output),
        )  # fmt: skip
    except OutputError as exc:
        _fail(session, build_id, f"The planner gave no usable plan: {exc}")
        raise PermanentJobError(f"plan-build gave no usable plan: {exc}") from exc
    except UsageLimitError:
        raise  # the worker pauses the queue and hands the job back
    except RunnerError as exc:
        if job.attempts >= job.max_attempts:
            _fail(session, build_id, f"The planner could not run: {exc}")
        raise
    build = session.get(Build, build_id)
    if build is None or build.state is not BuildState.PLANNING:
        return _skipped("the build changed while it was planned")
    replanning = _replanning(build)
    record_plan(session, build, run.output, origin=Origin.SKILL, model=run.model,
                feedback=build.plan_feedback if replanning else None,
                based_on=build.plan_version if replanning else None)  # fmt: skip
    build.state, build.error = BuildState.PLANNED, None
    session.add(build)
    session.commit()
    return HandlerResult(
        result={"build_id": str(build_id), "milestones": len(run.output["milestones"])},
        cost_tokens=run.cost_tokens,
    )


def run_plan(
    ctx: JobContext, *, runner: ModelRunner | None = None, skills_dir: Path | None = None
) -> HandlerResult:
    """Handler body for `build_plan`: the default CLI runner, recorded per call."""
    if runner is None:
        build = ctx.session.get(Build, _build_id(ctx.job))
        pinned = plan_runner(build) if build is not None else None
        runner = recorded(pinned or default_runner(), ctx.job, skill=SKILL_NAME)
    skill = load_skill((skills_dir or get_settings().skills_dir) / SKILL_NAME)
    return plan_build(ctx.session, ctx.job, runner=runner, skill=skill)

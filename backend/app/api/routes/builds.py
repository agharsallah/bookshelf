"""Builds (docs/BUILDS.md §4): from a paper to a repository.

Plan first (`POST /papers/{ref}/builds` queues `build_plan`), approve, then the agent builds
(`build_run`). Slow work is queued, so the transitions answer `202`; the UI polls
`GET /builds/{id}`. Wrong-state transitions are `409`, as are preflight errors (the failing
checks in `details`).

Building into an existing repository (§7c): `GET /builds/repos` lists what you can push to
(cached 60 s) and `POST /builds/target/inspect` checks a target and surveys it. They, the
preflight and the context render only read, but they read the machine (any local path,
`gh` as you) rather than the database, so they need the API key like a write.

The fixed `/builds/presets`, `/builds/preflight`, `/builds/repos` and
`/builds/target/inspect` are declared before `/builds/{build_id}`,
and `/papers/{ref}/builds/context` before anything a `{ref}/builds/<x>` could be read as.
The context routes (§7) show exactly what the planner and the agent read; the plan
version routes (§7b) list and restore what the plan has been.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query, Response, status
from sqlmodel import Session

from app.api.deps import SessionDep
from app.api.routes.documents import DocumentRef
from app.builds import context_view, plans, service, targets
from app.builds.agents import load_agent
from app.builds.github import GhCli, GitHub, GitHubError
from app.builds.preflight import Probe, preflight
from app.core.config import get_settings
from app.core.errors import ConflictError
from app.core.security import require_api_key
from app.models import Build
from app.models.build import BuildVisibility
from app.schemas.build_target import BuildTarget, RepoChoice, TargetInspection
from app.schemas.builds import (
    Approve,
    BuildContextView,
    BuildCreate,
    BuildPlanVersion,
    BuildPublic,
    BuildSummary,
    ContextPreview,
    ContextRender,
    Continue,
    PlanUpdate,
    PreflightPublic,
    PresetPublic,
    Replan,
)
from app.services import papers
from app.services.errors import InvalidInputError

router = APIRouter(tags=["builds"])


def get_probe() -> Probe | None:
    """The machine preflight inspects; None is the real one (tests override this)."""
    return None


def get_github() -> GitHub | None:
    """The GitHub client targets are inspected with; None is the real `gh` (tests override)."""
    return None


ProbeDep = Annotated[Probe | None, Depends(get_probe)]
GitHubDep = Annotated[GitHub | None, Depends(get_github)]
_WRITE = [Depends(require_api_key)]


def _public(session: Session, build: Build) -> BuildPublic:
    return BuildPublic.of(build, plan_versions_count=plans.versions_count(session, build))


def _summaries(session: Session, builds: list[Build]) -> list[BuildSummary]:
    """List rows, with every build's version count from one grouped query (no N+1)."""
    counts = plans.versions_counts(session, (b.id for b in builds))
    return [BuildSummary.of(b, plan_versions_count=counts.get(b.id, 0)) for b in builds]


@router.get("/builds/presets", response_model=list[PresetPublic], summary="Build presets")
def list_presets() -> list[PresetPublic]:
    return [PresetPublic.model_validate(p) for p in load_agent().presets]


@router.get(
    "/builds/preflight",
    dependencies=_WRITE,
    response_model=PreflightPublic,
    summary="What a build of this paper needs",
    description="Errors block a build, warnings say what the repo will lack; every failing "
    "check has a `fix`. `visibility=local` skips the GitHub checks.",
)
def get_preflight(
    session: SessionDep,
    probe: ProbeDep,
    document: Annotated[
        str, Query(min_length=1, max_length=200, description="Paper uuid or slug.")
    ],
    visibility: BuildVisibility = BuildVisibility.PRIVATE,
) -> PreflightPublic:
    paper = papers.get_paper(session, document)
    return PreflightPublic.model_validate(
        preflight(session, paper, visibility=visibility, probe=probe)
    )


@router.get(
    "/builds/repos",
    dependencies=_WRITE,
    response_model=list[RepoChoice],
    summary="GitHub repositories a build can go into",
    description="Yours and your organizations' (the 100 updated last, archived ones left "
    "out), filtered by `q` on the name and description; `can_push` says whether you may "
    "push. The listing is cached for 60 s; `409` when gh cannot list them.",
)
def list_repos(
    github: GitHubDep,
    q: Annotated[str, Query(max_length=100, description="Words to find.")] = "",
) -> list[RepoChoice]:
    settings = get_settings()
    try:
        rows = targets.list_repos(
            github or GhCli(settings.gh_bin),
            q,
            key=settings.gh_bin if github is None else str(id(github)),
        )
    except GitHubError as exc:
        raise ConflictError(str(exc)) from exc
    return [RepoChoice.model_validate(r) for r in rows]


@router.post(
    "/builds/target/inspect",
    dependencies=_WRITE,
    response_model=TargetInspection,
    summary="Check an existing repository as a build target, and survey it",
    description="The checks preflight runs for this target (each problem with its fix), the "
    "default branch, the branches, whether the folder exists and is empty at the base, and "
    "the survey the planner and the agent will read. A `new` target has nothing to inspect: "
    "`422`.",
)
def inspect_target(body: BuildTarget, github: GitHubDep) -> TargetInspection:
    if not body.existing:
        raise InvalidInputError("Only an existing repository can be inspected.", field="body.kind")
    settings = get_settings()
    client = github if github is not None or body.kind == "local" else GhCli(settings.gh_bin)
    return targets.inspect_target(body, github=client, git_bin=settings.git_bin)


@router.get(
    "/papers/{ref}/builds/context",
    response_model=ContextPreview,
    summary="What a build of this paper can read",
    description="The nine sections of `docs/PAPER.md` with their word counts (an empty one "
    'has `markdown: ""`), the header (`link_paper` defaults to the settings), and the '
    "references worth suggesting: code, data, the paper's own pages, cited works, and cited "
    "papers on the shelf.",
)
def get_context_preview(
    ref: DocumentRef, session: SessionDep, link_paper: bool | None = None
) -> ContextPreview:
    paper = papers.get_paper(session, ref)
    return context_view.preview(session, paper, link_paper=link_paper)


@router.post(
    "/papers/{ref}/builds/context/render",
    dependencies=_WRITE,
    response_model=BuildContextView,
    summary="Render what a build not created yet would read",
    description="The form's live preview: the options are filled from the preset and the "
    "settings as a create would fill them. Snapshots are listed as `pending` (nothing is "
    "fetched); the kickoff says the plan is drafted after you start.",
)
def render_context(
    ref: DocumentRef, body: ContextRender, session: SessionDep, github: GitHubDep
) -> BuildContextView:
    paper = papers.get_paper(session, ref)
    draft = context_view.draft(session, paper, body)
    return context_view.rendered_view(session, draft, github=github)


@router.get("/papers/{ref}/builds", response_model=list[BuildSummary], summary="A paper's builds")
def list_builds(ref: DocumentRef, session: SessionDep) -> list[BuildSummary]:
    paper = papers.get_paper(session, ref)
    return _summaries(session, service.list_builds(session, paper.id))


@router.post(
    "/papers/{ref}/builds",
    response_model=BuildPublic,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=_WRITE,
    summary="Start a build: plan it first",
    description="Runs preflight (`409` with the failing checks in `details`), fills options "
    "and stops from the preset and the settings, and queues `build_plan`.",
)
def create_build(
    ref: DocumentRef, body: BuildCreate, session: SessionDep, probe: ProbeDep, github: GitHubDep
) -> BuildPublic:
    paper = papers.get_paper(session, ref)
    build = service.create_build(session, paper, body, probe=probe, github=github)
    return _public(session, build)


@router.get("/builds/{build_id}", response_model=BuildPublic, summary="One build")
def get_build(build_id: uuid.UUID, session: SessionDep) -> BuildPublic:
    return _public(session, service.get_build(session, build_id))


@router.get(
    "/builds/{build_id}/context",
    response_model=BuildContextView,
    summary="What this build reads",
    description="`source: workspace` once the seed is written (the real files under docs/, "
    "README.md, LICENSE, and the kickoff it was given), else `rendered`. `command` is the "
    "CLI argv with the agent brief elided; `plan_input` is what the planner reads.",
)
def get_build_context(
    build_id: uuid.UUID, session: SessionDep, github: GitHubDep
) -> BuildContextView:
    build = service.get_build(session, build_id)
    return context_view.build_view(session, build, github=github)


@router.put(
    "/builds/{build_id}/plan",
    response_model=BuildPublic,
    dependencies=_WRITE,
    summary="Replace the plan with your edit",
)
def update_plan(build_id: uuid.UUID, body: PlanUpdate, session: SessionDep) -> BuildPublic:
    build = service.get_build(session, build_id)
    return _public(session, service.update_plan(session, build, body.plan))


@router.get(
    "/builds/{build_id}/plans",
    response_model=list[BuildPlanVersion],
    summary="Every version of the build's plan",
    description="Newest first; `current` marks the one `plan` is. Drafts, replans and your "
    "edits each append a version; a restore moves `current` without adding one.",
)
def list_plan_versions(build_id: uuid.UUID, session: SessionDep) -> list[BuildPlanVersion]:
    build = service.get_build(session, build_id)
    return [
        BuildPlanVersion.model_validate(
            {**r.model_dump(), "current": r.version == build.plan_version}
        )
        for r in plans.list_plan_versions(session, build)
    ]


@router.post(
    "/builds/{build_id}/plans/{version}/restore",
    response_model=BuildPublic,
    dependencies=_WRITE,
    summary="Make an older plan version current again",
    description="Only while `planned` (`409` otherwise; `404` for an unknown version). No "
    "version is added; the next edit or replan appends one based on this.",
)
def restore_plan(
    build_id: uuid.UUID, version: Annotated[int, Path(ge=1)], session: SessionDep
) -> BuildPublic:
    build = service.get_build(session, build_id)
    return _public(session, plans.restore_plan(session, build, version))


@router.post(
    "/builds/{build_id}/replan",
    response_model=BuildPublic,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=_WRITE,
    summary="Plan again with your feedback",
)
def replan(build_id: uuid.UUID, body: Replan, session: SessionDep) -> BuildPublic:
    build = service.get_build(session, build_id)
    return _public(session, service.replan(session, build, body.feedback))


@router.post(
    "/builds/{build_id}/approve",
    response_model=BuildPublic,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=_WRITE,
    summary="Approve the plan and start building",
    description="May override options and stops one last time; queues `build_run`.",
)
def approve(
    build_id: uuid.UUID,
    session: SessionDep,
    probe: ProbeDep,
    github: GitHubDep,
    body: Approve | None = None,
) -> BuildPublic:
    build = service.get_build(session, build_id)
    body = body or Approve()
    approved = service.approve(session, build, body.options, body.stops, probe=probe,
                               github=github)  # fmt: skip
    return _public(session, approved)


@router.post(
    "/builds/{build_id}/stop",
    response_model=BuildPublic,
    dependencies=_WRITE,
    summary="Stop a running build",
    description="The watcher kills the run and pushes what is committed.",
)
def stop(build_id: uuid.UUID, session: SessionDep) -> BuildPublic:
    return _public(session, service.request_stop(session, service.get_build(session, build_id)))


@router.post(
    "/builds/{build_id}/continue",
    response_model=BuildPublic,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=_WRITE,
    summary="Continue a finished build in the same repo and session",
)
def continue_build(build_id: uuid.UUID, body: Continue, session: SessionDep) -> BuildPublic:
    build = service.get_build(session, build_id)
    return _public(
        session, service.continue_build(session, build, goal=body.goal, stops=body.stops)
    )


@router.delete(
    "/builds/{build_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=_WRITE,
    summary="Forget a build",
    description="Not while it builds; the workspace and the GitHub repo are left alone.",
)
def delete_build(build_id: uuid.UUID, session: SessionDep) -> Response:
    service.delete_build(session, service.get_build(session, build_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)

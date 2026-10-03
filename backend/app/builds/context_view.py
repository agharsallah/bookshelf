"""What a build reads, shown to you (docs/BUILDS.md §7, B11): the three context endpoints.

preview(session, paper, link_paper)   the sections with their word counts, the header,
                                      and the suggested references
draft(session, paper, body)           an unsaved `Build` from the form, filled exactly as
                                      `service.create_build` would fill it
rendered_view(session, build)         files, kickoff, brief, tools, argv, plan input,
                                      rendered by the same functions the seed and the
                                      runner use (`workspace_files`, `launch`)
build_view(session, build)            the real files once the workspace holds a seed,
                                      else `rendered_view`
"""

from pathlib import Path
from typing import Literal

from sqlmodel import Session

from app.builds import planning, service
from app.builds.agents import AgentPackage, load_agent
from app.builds.context import paper_brief, paper_sections, render_header
from app.builds.git import Git, GitError
from app.builds.launch import elide_brief, launch_spec, resolve_toolchains
from app.builds.process import PROMPT_NAME
from app.builds.references import suggested_references
from app.builds.workspace_files import File, context_files, seed_files
from app.core.config import Settings, get_settings
from app.models import Build, Document
from app.schemas.builds import (
    BuildContextView,
    ContextFile,
    ContextPreview,
    ContextRender,
    ContextSection,
    SuggestedReference,
)
from app.services import app_settings
from app.services.errors import InvalidInputError

GOAL_PLACEHOLDER = "(your goal)"
SESSION_PLACEHOLDER = "<session id>"
MAX_FILE_BYTES = 512 * 1024
_ROOT_FILES = ("README.md", "LICENSE")


def author_name(settings: Settings) -> str | None:
    """Who the LICENSE names: the git author of this machine, as the seed commit will."""
    try:
        return Git(settings.git_bin, Path.home()).author_name()
    except GitError:
        return None


# --- the paper's sections -----------------------------------------------------------------


def preview(session: Session, paper: Document, *, link_paper: bool | None) -> ContextPreview:
    if link_paper is None:
        link_paper = app_settings.build_defaults(session).link_paper
    brief = paper_brief(session, paper)
    return ContextPreview(
        sections=[ContextSection.model_validate(s) for s in paper_sections(brief)],
        header=render_header(brief, link_paper=link_paper),
        suggested_references=[
            SuggestedReference.model_validate(s) for s in suggested_references(session, paper)
        ],
    )


# --- a build's input ----------------------------------------------------------------------


def draft(
    session: Session, paper: Document, body: ContextRender, *, agent: AgentPackage | None = None
) -> Build:
    """The build the form would create, unsaved (never added to the session)."""
    agent = agent or load_agent()
    preset = agent.preset(body.preset)
    if body.preset and preset is None:
        raise InvalidInputError(f"Unknown preset {body.preset!r}.", field="body.preset")
    defaults = app_settings.build_defaults(session)
    options = service.resolve_options(
        body.options, preset, defaults,
        repo_name=service.suggested_repo_name(paper, body.preset),
    )  # fmt: skip
    service.check_shelf_references(session, options)
    goal = (body.goal or "").strip() or (preset.goal if preset else GOAL_PLACEHOLDER)
    return Build(
        document_id=paper.id, agent=agent.name, preset=preset.key if preset else None,
        goal=goal, options=options.model_dump(mode="json"),
        stops=service.resolve_stops(body.stops, preset, defaults).model_dump(mode="json"),
    )  # fmt: skip


def _public(files: list[File]) -> list[ContextFile]:
    return [ContextFile(path=f.path, content=f.content, words=f.words, pending=f.pending)
            for f in files]  # fmt: skip


def _view(
    session: Session,
    build: Build,
    files: list[File],
    *,
    source: Literal["workspace", "rendered"],
    kickoff: str | None,
) -> BuildContextView:
    settings = get_settings()
    agent = load_agent(build.agent)
    document = session.get(Document, build.document_id)
    assert document is not None  # noqa: S101 - the foreign key cascades
    session_id = str(build.session_id) if build.session_id else SESSION_PLACEHOLDER
    spec = launch_spec(build, agent, settings, session_id=session_id,
                       budget=build.stops.get("max_budget_usd"))  # fmt: skip
    return BuildContextView(
        files=_public(files),
        kickoff=kickoff or spec.prompt,
        agent_brief=agent.brief,
        allowed_tools=spec.allowed_tools,
        command=elide_brief(spec.argv),
        model=spec.model,
        effort=spec.effort,
        plan_input=planning.plan_input(session, build, document),
        source=source,
    )


def rendered_view(session: Session, build: Build) -> BuildContextView:
    """What the build will receive, rendered now; snapshots are listed as pending."""
    settings = get_settings()
    author = author_name(settings)
    if build.plan:
        toolchains = resolve_toolchains(load_agent(build.agent), build)
        files = seed_files(session, build, author=author, fetch=None,
                           toolchains=toolchains).files  # fmt: skip
    else:
        files = context_files(session, build, author=author)
    return _view(session, build, files, source="rendered", kickoff=None)


def _read(path: Path, root: Path) -> File | None:
    try:
        data = path.read_bytes()[:MAX_FILE_BYTES]
    except OSError:
        return None
    return File(str(path.relative_to(root)), data.decode("utf-8", errors="replace"))


def workspace_files(repo: Path) -> list[File]:
    """README.md and LICENSE, then every file under docs/ (sorted), as they are on disk."""
    paths = [repo / name for name in _ROOT_FILES if (repo / name).is_file()]
    paths += sorted(p for p in (repo / "docs").rglob("*") if p.is_file())
    return [f for p in paths if (f := _read(p, repo)) is not None]


def build_view(session: Session, build: Build) -> BuildContextView:
    """The real files once the workspace holds the seed (`source: workspace`)."""
    repo = Path(build.workspace) if build.workspace else None
    if repo is None or not (repo / "docs" / "PAPER.md").is_file():
        return rendered_view(session, build)
    prompt_file = repo.parent / PROMPT_NAME
    kickoff = prompt_file.read_text("utf-8") if prompt_file.is_file() else None
    return _view(session, build, workspace_files(repo), source="workspace", kickoff=kickoff)

"""What a build's repository starts with, rendered once for the preview and the seed (B11).

    context_files(session, build)   what the agent reads about the paper: docs/PAPER.md (the
                                    kept sections, `link_paper`), docs/REFERENCES.md,
                                    docs/references/NN-*.md, docs/NOTES.md, LICENSE. Snapshots
                                    are `pending` (a preview never fetches)
    seed_files(session, build, …)   the same with snapshots fetched, plus README.md,
                                    docs/PLAN.md (headed by its plan version) and .gitignore:
                                    the seed commit, and the warnings for snapshots that
                                    failed (link-only then)

`build` is a `Build` row, saved or not: the form's live preview renders an unsaved one.
Building into an existing repository (§7c), every path is under `options.target.folder`
(`papers/attention/README.md`, `papers/attention/docs/PAPER.md`…).
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime

from sqlmodel import Session, col, select

from app.builds.context import PaperBrief, paper_brief, render_paper_md, word_count
from app.builds.launch import options_of
from app.builds.licenses import license_text
from app.builds.plans import current_version
from app.builds.references import (
    Fetch,
    pending_snapshot,
    reference_path,
    render_references_md,
    snapshot,
)
from app.builds.seed import plan_heading, render_gitignore, render_plan, render_readme
from app.models import Build, Document
from app.schemas.build_options import BuildReference
from app.schemas.builds import BuildOptions


@dataclass(frozen=True, slots=True)
class File:
    path: str
    content: str
    pending: bool = False  # a snapshot the seed will fetch

    @property
    def words(self) -> int:
        return word_count(self.content)


@dataclass(slots=True)
class Rendered:
    files: list[File]
    warnings: list[str] = field(default_factory=list)  # failed snapshots, missing papers


def _document(session: Session, build: Build) -> Document:
    document = session.get(Document, build.document_id)
    if document is None:  # pragma: no cover - the foreign key cascades
        raise LookupError("the build's paper no longer exists")
    return document


def _shelf_papers(session: Session, refs: Sequence[BuildReference]) -> dict[uuid.UUID, Document]:
    ids = [r.document_id for r in refs if r.document_id is not None]
    if not ids:
        return {}
    rows = session.exec(select(Document).where(col(Document.id).in_(ids))).all()
    return {d.id: d for d in rows}


def _references(session: Session, refs: Sequence[BuildReference], fetch: Fetch | None) -> Rendered:
    """docs/REFERENCES.md and its files. Without `fetch`, snapshots are pending."""
    shelf = _shelf_papers(session, refs)
    out = Rendered(files=[])
    written: dict[int, str] = {}
    for number, ref in enumerate(refs, 1):
        path = reference_path(number, ref)
        if path is None:
            continue
        if ref.kind == "shelf":
            paper = shelf.get(ref.document_id) if ref.document_id else None
            if paper is None:
                out.warnings.append(f"Reference {ref.title!r} is no longer on the shelf.")
                continue
            brief = render_paper_md(paper_brief(session, paper), link_paper=True)
            out.files.append(File(path, brief))
        elif fetch is None:
            out.files.append(File(path, pending_snapshot(ref), pending=True))
        else:
            result = snapshot(ref, path, fetch=fetch)
            if result.content is None:
                out.warnings.append(
                    f"Could not snapshot {ref.url} ({result.error}); it stays a link."
                )
                continue
            out.files.append(File(path, result.content))
        written[number] = path
    titles = {doc_id: doc.title for doc_id, doc in shelf.items()}
    index = File("docs/REFERENCES.md", render_references_md(refs, titles, written))
    out.files.insert(0, index)
    return out


def _render(
    session: Session,
    build: Build,
    *,
    author: str | None,
    fetch: Fetch | None,
    now: datetime | None,
) -> tuple[Rendered, PaperBrief, BuildOptions]:
    options = options_of(build)
    brief = paper_brief(session, _document(session, build))
    paper = render_paper_md(brief, link_paper=options.link_paper,
                            sections=options.context.sections)  # fmt: skip
    out = Rendered(files=[File("docs/PAPER.md", paper)])
    if options.references:
        refs = _references(session, options.references, fetch)
        out.files += refs.files
        out.warnings += refs.warnings
    if notes := (options.context.notes or "").strip():
        out.files.append(File("docs/NOTES.md", f"# Notes from the reader\n\n{notes}\n"))
    year = (now or datetime.now(UTC)).year
    if text := license_text(options.advanced.license, year=year, holder=author):
        out.files.append(File("LICENSE", text))
    return out, brief, options


def _plan_heading(session: Session, build: Build) -> str | None:
    """`Plan v3 (edited by you, from v2)` for the build's current version, if it has one."""
    record = current_version(session, build)
    if record is None:
        return None
    return plan_heading(record.version, origin=record.origin.value, based_on=record.based_on,
                        feedback=record.feedback)  # fmt: skip


def in_folder(files: Sequence[File], folder: str | None) -> list[File]:
    """`files` moved under `folder` (an existing repository's target folder), if any."""
    if folder is None:
        return list(files)
    return [File(f"{folder}/{f.path}", f.content, f.pending) for f in files]


def context_files(
    session: Session, build: Build, *, author: str | None = None, now: datetime | None = None
) -> list[File]:
    """The context the agent reads, as a preview: nothing is fetched."""
    rendered, _, options = _render(session, build, author=author, fetch=None, now=now)
    return in_folder(rendered.files, options.target.folder)


def seed_files(
    session: Session,
    build: Build,
    *,
    author: str | None,
    fetch: Fetch | None,
    toolchains: Sequence[str] = (),
    now: datetime | None = None,
) -> Rendered:
    """Every file of the seed commit. `fetch=None` renders it as a preview (snapshots
    pending), which is what `/builds/{id}/context` shows before the workspace exists."""
    rendered, brief, options = _render(session, build, author=author, fetch=fetch, now=now)
    plan = build.plan or {}
    readme = render_readme(
        plan=plan, goal=build.goal, title=brief.title, link_paper=options.link_paper,
        coauthor=options.claude_attribution,
        paper_url=brief.links[0][1] if brief.links else None,
    )  # fmt: skip
    rendered.files = [
        File("README.md", readme),
        rendered.files[0],  # docs/PAPER.md
        File(
            "docs/PLAN.md",
            render_plan(plan, goal=build.goal, heading=_plan_heading(session, build)),
        ),
        *rendered.files[1:],
        File(".gitignore", render_gitignore(toolchains)),
    ]
    rendered.files = in_folder(rendered.files, options.target.folder)
    return rendered

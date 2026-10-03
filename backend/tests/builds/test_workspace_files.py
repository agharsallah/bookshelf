"""One rendering path (B11): the preview's files are the seed's files."""

from datetime import UTC, datetime
from typing import Any

from sqlmodel import Session

from app.builds.references import FetchedText
from app.builds.workspace_files import context_files, seed_files
from app.models import Build
from tests.builds.factories import GOAL, known_paper, valid_plan
from tests.papers.conftest import make_paper

NOW = datetime(2026, 10, 3, tzinfo=UTC)


def draft(paper_id: Any, **options: Any) -> Build:
    return Build(document_id=paper_id, goal=GOAL, options={"repo_name": "gated", **options},
                 stops={"max_minutes": 90, "max_commits": 30}, plan=valid_plan())  # fmt: skip


def by_path(files: list) -> dict[str, Any]:
    return {f.path: f for f in files}


def fetch_ok(url: str) -> FetchedText:
    return FetchedText(url=url, title="Post", text="The post's text.")


def fetch_down(_url: str) -> FetchedText:
    raise TimeoutError("timed out")


def test_a_bare_build_reads_only_the_paper(session: Session):
    files = context_files(session, draft(known_paper(session).id))

    assert [f.path for f in files] == ["docs/PAPER.md"]


def test_preview_and_seed_render_the_same_context(session: Session):
    paper = known_paper(session)
    shelf = make_paper(session, "Dense Passage Retrieval")
    build = draft(
        paper.id, link_paper=False,
        context={"sections": ["tldr", "claims"], "notes": "Use NumPy, not PyTorch."},
        references=[
            {"kind": "url", "url": "https://blog.example/gates", "title": "Gates",
             "snapshot": True},
            {"kind": "url", "url": "https://docs.example", "title": "Docs"},
            {"kind": "shelf", "document_id": str(shelf.id), "title": "DPR"},
        ],
        advanced={"license": "MIT"},
    )  # fmt: skip

    preview = by_path(context_files(session, build, author="Ada", now=NOW))
    seed = seed_files(session, build, author="Ada", fetch=fetch_ok, toolchains=["python"],
                      now=NOW)  # fmt: skip
    seeded = by_path(seed.files)

    assert list(preview) == [
        "docs/PAPER.md", "docs/REFERENCES.md", "docs/references/01-gates.md",
        "docs/references/03-dpr.md", "docs/NOTES.md", "LICENSE",
    ]  # fmt: skip
    assert list(seeded) == ["README.md", "docs/PAPER.md", "docs/PLAN.md", *list(preview)[1:],
                            ".gitignore"]  # fmt: skip
    for path in ("docs/PAPER.md", "docs/REFERENCES.md", "docs/references/03-dpr.md",
                 "docs/NOTES.md", "LICENSE"):  # fmt: skip
        assert preview[path].content == seeded[path].content, path
    paper_md = preview["docs/PAPER.md"].content
    assert "## TL;DR" in paper_md and "## Claims" in paper_md and "## Setup" not in paper_md
    assert "Gated Readers" not in paper_md  # link_paper off
    assert preview["docs/references/01-gates.md"].pending
    assert not seeded["docs/references/01-gates.md"].pending
    assert "The post's text." in seeded["docs/references/01-gates.md"].content
    assert preview["docs/references/03-dpr.md"].content.startswith("# Dense Passage Retrieval")
    assert "Use NumPy, not PyTorch." in preview["docs/NOTES.md"].content
    assert "Copyright (c) 2026 Ada" in preview["LICENSE"].content
    assert seed.warnings == []


def test_a_failed_snapshot_leaves_a_link_and_a_warning(session: Session):
    build = draft(known_paper(session).id, references=[
        {"kind": "url", "url": "https://down.example", "title": "Down", "snapshot": True},
    ])  # fmt: skip

    seed = seed_files(session, build, author=None, fetch=fetch_down)
    files = by_path(seed.files)

    assert "docs/references/01-down.md" not in files
    assert "snapshot:" not in files["docs/REFERENCES.md"].content
    assert "[Down](https://down.example)" in files["docs/REFERENCES.md"].content
    assert seed.warnings == [
        "Could not snapshot https://down.example (timed out); it stays a link."
    ]


def test_apache_names_the_year_and_falls_back_to_the_authors(session: Session):
    build = draft(known_paper(session).id, advanced={"license": "Apache-2.0"})

    license_ = by_path(context_files(session, build, now=NOW))["LICENSE"].content

    assert "Apache License" in license_ and "Version 2.0, January 2004" in license_
    assert "Copyright 2026 The authors" in license_

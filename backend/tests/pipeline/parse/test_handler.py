"""The `parse` job handler end to end: document row + file → nodes, status, metadata."""

from pathlib import Path

import pytest
from sqlmodel import Session, func, select

from app.core.config import get_settings
from app.jobs import queue
from app.jobs.queue import JobSpec
from app.jobs.registry import JobContext, PermanentJobError, get_handler
from app.models import Document, Job, Node
from app.models.enums import DocumentKind, DocumentStatus, JobKind
from app.pipeline.handlers.parse import run_parse
from tests.pipeline.parse.builders import book_pdf
from tests.pipeline.parse.epub_builders import book_epub


def _document(session: Session, source_path: str, **overrides: object) -> Document:
    fields: dict[str, object] = {
        "kind": DocumentKind.PDF, "slug": "meadows-systems", "title": "meadows-systems",
        "sha256": "c" * 64, "source_path": source_path,
    }  # fmt: skip
    doc = Document(**(fields | overrides))
    session.add(doc)
    session.commit()
    return doc


def _job(session: Session, document: Document) -> Job:
    job = queue.enqueue(session, JobSpec(kind=JobKind.PARSE, document_id=document.id))
    assert job is not None
    return job


def _run(session: Session, document: Document):
    """Run the handler on a fresh job and finish it, as the worker would."""
    job = _job(session, document)
    result = run_parse(JobContext(session=session, job=job))
    queue.complete(session, job, result=result.result)
    session.refresh(document)
    return result


def _node_count(session: Session, document: Document) -> int:
    query = select(func.count()).select_from(Node).where(Node.document_id == document.id)
    return int(session.exec(query).one())


def test_parse_is_registered_for_the_parse_job_kind():
    assert get_handler(JobKind.PARSE) is run_parse


def test_pdf_with_outline_is_parsed_stored_and_described(session, library_dir: Path):
    book_pdf(library_dir / "meadows-systems.pdf")
    document = _document(session, "library/meadows-systems.pdf")

    result = _run(session, document)

    assert result.result["tier"] == 1
    assert result.result["nodes"] == _node_count(session, document) > 10
    assert (document.status, document.parse_tier, document.page_count) == (
        DocumentStatus.PARSED, 1, 3
    )  # fmt: skip
    assert (document.title, document.authors, document.year) == (
        "Thinking in Systems", ["Donella Meadows"], 2008
    )  # fmt: skip


def test_epub_is_parsed_stored_and_described(session, library_dir: Path):
    book_epub(library_dir / "systems.epub")
    document = _document(session, "library/systems.epub", kind=DocumentKind.EPUB,
                         slug="systems", title="systems")  # fmt: skip

    result = _run(session, document)

    assert (result.result["tier"], result.result["nodes"]) == (1, _node_count(session, document))
    assert (document.status, document.parse_tier, document.page_count) == (
        DocumentStatus.PARSED, 1, 12
    )  # fmt: skip
    assert (document.title, document.authors, document.year) == (
        "Thinking in Systems", ["Donella Meadows"], 2008
    )  # fmt: skip
    figures = session.exec(select(Node).where(Node.kind == "figure")).all()
    media_dir = get_settings().media_dir
    assert figures and all((media_dir / f.meta["image_path"]).is_file() for f in figures)


def test_guessed_outline_lands_in_needs_review_and_keeps_human_metadata(session, library_dir: Path):
    book_pdf(library_dir / "untitled.pdf", toc=False)
    document = _document(session, "library/untitled.pdf", title="My Own Title", year=1972)

    result = _run(session, document)

    assert (result.result["tier"], result.result["needs_review"]) == (2, True)
    assert document.status is DocumentStatus.NEEDS_REVIEW
    assert (document.title, document.year) == ("My Own Title", 1972)
    assert document.authors == ["Donella Meadows"]  # was empty, so it is filled


def test_reparse_with_outline_override_keeps_node_ids_and_clears_review(session, library_dir: Path):
    book_pdf(library_dir / "untitled.pdf", toc=False)
    document = _document(session, "library/untitled.pdf")
    _run(session, document)
    ids = {n.anchor: n.id for n in session.exec(select(Node)).all()}

    document.outline_override = [
        {"title": "Chapter 1 Stocks", "page_from": 1, "sections": [
            {"title": "1.1 Flows", "page_from": 1}]},
        {"title": "Chapter 2 Loops", "page_from": 2},
    ]  # fmt: skip
    session.add(document)
    session.commit()
    _run(session, document)

    after = {n.anchor: n.id for n in session.exec(select(Node)).all()}
    assert after == ids  # same boundaries as detected, so every row survives
    assert document.status is DocumentStatus.PARSED


@pytest.mark.parametrize(
    ("source_path", "reason"),
    [
        ("library/missing.pdf", "file not found"),
        ("library/../../outside.pdf", "escapes the repository"),
        ("library/notes.txt", "unsupported file type"),
        (None, "no source file"),
    ],
    ids=["missing", "escape", "unsupported", "no-path"],
)
def test_bad_source_fails_permanently_and_marks_parse_failed(
    session, library_dir: Path, source_path: str | None, reason: str
):
    (library_dir / "notes.txt").write_text("not a book")
    document = _document(session, "library/placeholder.pdf", source_uri="https://x.org")
    document.source_path = source_path
    session.add(document)
    session.commit()

    with pytest.raises(PermanentJobError, match=reason):
        _run(session, document)

    session.refresh(document)
    assert document.status is DocumentStatus.PARSE_FAILED
    assert _node_count(session, document) == 0


def test_invalid_outline_override_fails_permanently(session, library_dir: Path):
    book_pdf(library_dir / "meadows-systems.pdf")
    document = _document(
        session, "library/meadows-systems.pdf", outline_override=[{"title": "", "page_from": 1}]
    )

    with pytest.raises(PermanentJobError, match="parse failed"):
        _run(session, document)

    session.refresh(document)
    assert document.status is DocumentStatus.PARSE_FAILED


def test_markdown_article_is_parsed_without_review(session, library_dir: Path):
    (library_dir / "notes.md").write_text("# Notes\n\n## One\n\nA paragraph.\n")
    document = _document(session, "library/notes.md", kind=DocumentKind.ARTICLE)

    result = _run(session, document)

    assert {k: v for k, v in result.result.items() if k != "pruned_media"} == {
        "nodes": 2, "tier": 1, "needs_review": False, "warnings": []
    }  # fmt: skip
    assert (document.status, document.title) == (DocumentStatus.PARSED, "Notes")


def test_reparse_deletes_crops_no_node_references_and_nothing_else(session, library_dir: Path):
    from app.core.config import get_settings

    media = get_settings().media_dir
    stale = media / "prune-check" / "ch09" / "f001.png"
    other = media / "senge-fifth" / "ch01" / "f001.png"
    for file in (stale, other):
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(b"png")
    (library_dir / "notes.md").write_text("# Notes\n\nA paragraph.\n")
    document = _document(session, "library/notes.md", kind=DocumentKind.ARTICLE, slug="prune-check")

    result = _run(session, document)

    assert result.result["pruned_media"] == 1
    assert not (media / "prune-check" / "ch09").exists()
    assert other.read_bytes() == b"png"

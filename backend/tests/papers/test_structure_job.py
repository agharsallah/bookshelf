"""parse → paper_structure end to end on a generated paper PDF, against the test database."""

import hashlib
import uuid
from pathlib import Path

import httpx
import pytest
from sqlmodel import Session, col, select

from app.jobs import queue
from app.jobs.queue import JobSpec
from app.jobs.registry import get_handler
from app.models import Document, Job, Node, PaperMeta, PaperReference
from app.models.enums import (
    CitationIntent,
    DocumentKind,
    DocumentStatus,
    Genre,
    JobKind,
    JobState,
    PaperMetaSource,
)
from app.papers.grobid import Grobid, parse_header, parse_references
from app.papers.structure import run_structure
from app.pipeline import orchestrator
from app.pipeline.handlers.paper_structure import run_paper_structure
from app.pipeline.handlers.parse import run_parse
from tests.papers.conftest import job_context, make_paper
from tests.papers.paper_pdf import ARXIV_ID, AUTHORS, TITLE, paper_pdf

FIXTURES = Path(__file__).parent / "fixtures"


def _document(session: Session, library_dir: Path) -> Document:
    token = uuid.uuid4().hex[:8]
    paper_pdf(library_dir / f"tiny-{token}.pdf")
    document = Document(
        kind=DocumentKind.PDF,
        slug=f"tiny-{token}",
        title=f"tiny-{token}",
        sha256=hashlib.sha256(token.encode()).hexdigest(),
        source_path=f"library/tiny-{token}.pdf",
    )
    session.add(document)
    session.commit()
    return document


def _run(session: Session, kind: JobKind, document: Document) -> Job:
    ctx = job_context(session, JobSpec(kind=kind, document_id=document.id))
    result = get_handler(kind)(ctx)
    queue.complete(session, ctx.job, result=result.result, state=result.state)
    session.refresh(document)
    return ctx.job


@pytest.fixture
def parsed_paper(session: Session, library_dir: Path) -> Document:
    document = _document(session, library_dir)
    _run(session, JobKind.PARSE, document)
    return document


def _units(session: Session, document: Document) -> dict[str, dict[str, object]]:
    rows = session.exec(
        select(Node).where(Node.document_id == document.id, col(Node.parent_id).is_(None))
    ).all()
    return {n.heading or "": n.meta for n in rows}


def _references(session: Session, document: Document) -> list[PaperReference]:
    query = select(PaperReference).where(PaperReference.document_id == document.id)
    return list(session.exec(query.order_by(col(PaperReference.ordinal))).all())


def test_the_handlers_are_registered():
    assert get_handler(JobKind.PAPER_STRUCTURE) is run_paper_structure
    assert get_handler(JobKind.PARSE) is run_parse


def test_a_detected_paper_parses_without_review_and_queues_its_structure(
    session: Session, library_dir: Path
):
    document = _document(session, library_dir)

    job = _run(session, JobKind.PARSE, document)

    assert (document.genre, document.status, document.title) == (
        Genre.PAPER,
        DocumentStatus.PARSED,
        TITLE,
    )
    assert document.meta["genre_source"] == "detected"
    queued = orchestrator.on_job_done(session, job)
    assert [j.kind for j in queued] == [JobKind.PAPER_STRUCTURE]


def test_structure_tags_roles_parses_references_and_links_citations(
    session: Session, parsed_paper: Document
):
    shelf = make_paper(session, "Attention is all you need", meta={"arxiv_id": "1706.03762"})

    job = _run(session, JobKind.PAPER_STRUCTURE, parsed_paper)

    assert job.state is JobState.DONE
    units = _units(session, parsed_paper)
    assert {h: m.get("role") for h, m in units.items() if "role" in m} == {
        "Abstract": "abstract",
        "1 Introduction": "introduction",
        "2 Method": "method",
        "3 Results": "results",
        "4 Conclusion": "conclusion",
        "Acknowledgements": "other",
        "References": "references",
    }
    assert units["Acknowledgements"]["skip"] and units["References"]["skip"]
    refs = _references(session, parsed_paper)
    assert [(r.ordinal, r.title) for r in refs] == [
        (1, "A first engine paper"),
        (2, "Attention is all you need"),
        (3, "Compilers for everyone"),
    ]
    assert refs[0].cited_at == ["ch02/p001", "ch03/s01/p001"]  # [1] and [1-3]
    assert refs[2].cited_at == ["ch02/p001", "ch03/s01/p001"]  # [2, 3] and [1-3]
    assert (refs[1].arxiv_id, refs[1].target_document_id) == ("1706.03762", shelf.id)
    assert refs[2].doi == "10.1145/123.456"
    meta = session.get(PaperMeta, parsed_paper.id)
    assert meta is not None
    assert (meta.arxiv_id, meta.year, meta.reference_count, meta.source) == (
        ARXIV_ID,
        2021,
        3,
        PaperMetaSource.PARSED,
    )
    assert meta.abstract is not None and meta.abstract.endswith("We show tiny models work.")
    assert parsed_paper.authors == AUTHORS
    assert job.result is not None and job.result["cited_references"] == 3


def test_rerunning_updates_in_place_keeps_intents_and_drops_vanished_entries(
    session: Session, parsed_paper: Document
):
    _run(session, JobKind.PAPER_STRUCTURE, parsed_paper)
    first = {r.ordinal: r.id for r in _references(session, parsed_paper)}
    refs = _references(session, parsed_paper)
    refs[0].intent = CitationIntent.USES
    session.add(refs[0])
    session.add(PaperReference(document_id=parsed_paper.id, ordinal=99, raw="gone"))
    session.commit()

    _run(session, JobKind.PAPER_STRUCTURE, parsed_paper)

    again = _references(session, parsed_paper)
    assert {r.ordinal: r.id for r in again} == first
    assert again[0].intent is CitationIntent.USES


def test_a_human_paper_meta_row_is_never_overwritten(session: Session, parsed_paper: Document):
    session.add(PaperMeta(document_id=parsed_paper.id, doi="10.9/me", source=PaperMetaSource.HUMAN))
    session.commit()

    _run(session, JobKind.PAPER_STRUCTURE, parsed_paper)

    meta = session.get(PaperMeta, parsed_paper.id)
    assert meta is not None and (meta.doi, meta.arxiv_id) == ("10.9/me", None)
    assert len(_references(session, parsed_paper)) == 3


def test_a_book_is_skipped(session: Session, library_dir: Path):
    document = _document(session, library_dir)
    document.genre, document.meta = Genre.BOOK, {"genre_source": "human"}
    session.add(document)
    session.commit()

    job = _run(session, JobKind.PAPER_STRUCTURE, document)

    assert job.state is JobState.SKIPPED


# --- GROBID ------------------------------------------------------------------------------------


def _grobid(status: int = 200) -> tuple[Grobid, list[str]]:
    seen: list[str] = []

    def answer(request: httpx.Request) -> httpx.Response:
        service = request.url.path.rsplit("/", 1)[-1]
        seen.append(service)
        if status != 200:
            return httpx.Response(status)
        name = "grobid_header" if service == "processHeaderDocument" else "grobid_references"
        return httpx.Response(200, content=(FIXTURES / f"{name}.tei.xml").read_bytes())

    client = httpx.Client(transport=httpx.MockTransport(answer))
    return Grobid(client, "http://grobid.test/"), seen


def test_grobid_tei_maps_to_header_fields_and_references():
    header = parse_header((FIXTURES / "grobid_header.tei.xml").read_bytes())
    refs = parse_references((FIXTURES / "grobid_references.tei.xml").read_bytes())

    assert (header.title, header.authors, header.doi, header.arxiv_id, header.year) == (
        "Tiny Transformers Work",
        ["Ada Lovelace", "Alan M Turing"],
        "10.1234/tiny.2021",
        "2101.00001",
        2021,
    )
    assert header.abstract == "Tiny models work, and fast."
    assert [(r.ordinal, r.title, r.venue, r.arxiv_id) for r in refs] == [
        (1, "A first engine paper", "Proceedings of Engines", None),
        (2, "Attention is all you need", "arXiv", "1706.03762"),
    ]
    assert refs[0].raw.startswith("Ada Lovelace. A first engine paper")


def test_structure_prefers_grobid_when_configured(
    session: Session, parsed_paper: Document, library_dir: Path
):
    grobid, seen = _grobid()

    run_structure(session, parsed_paper, library_dir=library_dir, grobid=grobid)

    assert seen == ["processHeaderDocument", "processReferences"]
    meta = session.get(PaperMeta, parsed_paper.id)
    assert meta is not None and (meta.doi, meta.source) == ("10.1234/tiny.2021", "grobid")
    assert [r.title for r in _references(session, parsed_paper)] == [
        "A first engine paper",
        "Attention is all you need",
    ]


def test_a_failing_grobid_falls_back_to_the_parsed_structure(
    session: Session, parsed_paper: Document, library_dir: Path
):
    grobid, _ = _grobid(status=503)

    report = run_structure(session, parsed_paper, library_dir=library_dir, grobid=grobid)

    assert (report["source"], report["references"]) == ("parsed", 3)


def test_a_moved_source_file_skips_grobid_instead_of_failing(
    session: Session, parsed_paper: Document, library_dir: Path
):
    """Regression: with GROBID on, a missing PDF raised FileNotFoundError, retried in vain;
    the tree is in the database, so the parsed structure still applies."""
    grobid, seen = _grobid()
    (library_dir.parent / parsed_paper.source_path).unlink()

    report = run_structure(session, parsed_paper, library_dir=library_dir, grobid=grobid)

    assert seen == []
    assert (report["source"], report["references"]) == ("parsed", 3)

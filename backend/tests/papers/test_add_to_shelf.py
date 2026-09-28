"""`paper_fetch`: candidate → open-access PDF → library/papers/ → ingested as a paper."""

from pathlib import Path

import httpx
import pytest
from sqlmodel import Session, select

from app.jobs.queue import JobSpec
from app.jobs.registry import PermanentJobError
from app.models import Document, Job, PaperMeta, ReadingCandidate
from app.models.enums import CandidateStatus, Genre, JobKind, PaperMetaSource
from app.pipeline.handlers.paper_external import run_paper_fetch
from tests.papers.conftest import job_context
from tests.papers.fake_openalex import FakeOpenAlex

PDF = b"%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"


def candidate(session: Session, **fields) -> ReadingCandidate:
    row = ReadingCandidate(**({"title": "Attention Is All You Need"} | fields))
    session.add(row)
    session.commit()
    return row


def fetch(session: Session, row: ReadingCandidate) -> dict:
    spec = JobSpec(
        kind=JobKind.PAPER_FETCH, input_hash=str(row.id), payload={"candidate_id": str(row.id)}
    )
    return run_paper_fetch(job_context(session, spec)).result


def serve_pdf(openalex: FakeOpenAlex, body: bytes = PDF, content_type: str = "application/pdf"):
    openalex.fallback = lambda request: httpx.Response(
        200, content=body, headers={"content-type": content_type}
    )


def test_a_candidate_is_downloaded_ingested_as_a_paper_and_marked(
    session: Session, openalex: FakeOpenAlex, papers_dir: Path
):
    serve_pdf(openalex)
    row = candidate(
        session, arxiv_id="1706.03762", openalex_id="W100", doi="10.1/attn", year=2017,
        authors=["Ashish Vaswani"], venue="NeurIPS", cited_by_count=9,
    )  # fmt: skip

    result = fetch(session, row)

    assert result["source_path"] == "library/papers/attention-is-all-you-need.pdf"
    assert (papers_dir / "attention-is-all-you-need.pdf").read_bytes() == PDF
    assert str(openalex.requests[0].url) == "https://arxiv.org/pdf/1706.03762"
    document = session.get(Document, result["document_id"])
    assert document is not None and document.genre == Genre.PAPER
    assert (document.title, document.authors, document.year) == (
        row.title,
        ["Ashish Vaswani"],
        2017,
    )
    meta = session.get(PaperMeta, document.id)
    assert meta is not None and (meta.openalex_id, meta.venue) == ("W100", "NeurIPS")
    assert meta.source == PaperMetaSource.OPENALEX
    session.refresh(row)
    assert (row.status, row.document_id) == (CandidateStatus.INGESTED, document.id)
    parse = session.exec(select(Job).where(Job.document_id == document.id)).one()
    assert parse.kind == JobKind.PARSE


def test_the_same_pdf_twice_links_the_existing_document_and_keeps_one_file(
    session: Session, openalex: FakeOpenAlex, papers_dir: Path
):
    serve_pdf(openalex)
    first = fetch(session, candidate(session, pdf_url="https://oa.test/a.pdf"))
    twin = candidate(session, pdf_url="https://oa.test/b.pdf", title="Same paper, other entry")
    second = fetch(session, twin)
    assert second["already_on_shelf"] and second["document_id"] == first["document_id"]
    assert [p.name for p in papers_dir.iterdir()] == ["attention-is-all-you-need.pdf"]
    session.refresh(twin)
    assert twin.status == CandidateStatus.INGESTED


def test_a_landing_page_instead_of_a_pdf_fails_permanently_and_leaves_no_trace(
    session: Session, openalex: FakeOpenAlex, papers_dir: Path
):
    serve_pdf(openalex, b"<html>paywall</html>", "text/html")
    row = candidate(session, pdf_url="https://oa.test/landing")
    with pytest.raises(PermanentJobError):
        fetch(session, row)
    session.refresh(row)
    assert row.status == CandidateStatus.SUGGESTED
    assert not papers_dir.exists() or not any(papers_dir.iterdir())
    assert session.exec(select(Document)).all() == []


def test_a_missing_candidate_fails_permanently(session: Session, openalex: FakeOpenAlex):
    spec = JobSpec(kind=JobKind.PAPER_FETCH, payload={"candidate_id": "not-a-uuid"})
    with pytest.raises(PermanentJobError):
        run_paper_fetch(job_context(session, spec))

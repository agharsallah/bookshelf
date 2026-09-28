"""`paper_fetch`: put a reading candidate on the shelf (docs/PAPERS.md §5 "Add to shelf").

    candidate ─► fetch_pdf (arXiv, else the open-access URL) ─► library/papers/<slug>.pdf
        ─► services.ingest.ingest_path(genre = paper) ─► parse job
        ─► paper_meta from the candidate (source = openalex) ─► candidate: ingested, document_id

Content that is already on the shelf (same sha256) is not ingested twice: the candidate is
linked to the existing document instead. The download runs with the session released.
"""

import logging
import uuid
from dataclasses import dataclass
from pathlib import Path

import httpx
from sqlmodel import Session

from app.core.errors import ConflictError
from app.db.session import release
from app.jobs.registry import PermanentJobError
from app.models import Document, PaperMeta, ReadingCandidate
from app.models.enums import CandidateStatus, Genre, PaperMetaSource
from app.papers.fetch_pdf import fetch_pdf, pdf_is_taken
from app.services import library
from app.services.ingest import IngestMetadata, ingest_path

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class Added:
    document_id: uuid.UUID
    source_path: str | None
    already_on_shelf: bool = False


def add_to_shelf(
    session: Session, candidate_id: uuid.UUID, client: httpx.Client, library_dir: Path
) -> Added:
    """Download the candidate's PDF and ingest it as a paper; commits."""
    candidate = session.get(ReadingCandidate, candidate_id)
    if candidate is None:
        raise PermanentJobError(f"Reading candidate {candidate_id} does not exist.")
    if candidate.status == CandidateStatus.INGESTED and candidate.document_id is not None:
        return Added(document_id=candidate.document_id, source_path=None, already_on_shelf=True)
    slug = library.unique_slug(session, candidate.title, is_taken=pdf_is_taken(library_dir))
    release(session)
    path = fetch_pdf(
        client, library_dir, slug=slug, arxiv_id=candidate.arxiv_id, pdf_url=candidate.pdf_url
    )
    meta = IngestMetadata(
        title=candidate.title,
        authors=list(candidate.authors) or None,
        year=candidate.year,
        genre=Genre.PAPER,
    )
    try:
        document, _ = ingest_path(session, library_dir, path, meta)
    except ConflictError as exc:
        existing = _existing_document(exc)
        if existing is None:
            raise
        library.resolve_library_file(library_dir, path).unlink(missing_ok=True)
        _mark_ingested(session, candidate_id, existing)
        return Added(document_id=existing, source_path=None, already_on_shelf=True)
    _write_meta(session, candidate, document)
    _mark_ingested(session, candidate_id, document.id)
    logger.info("Candidate added to shelf", extra={"document_id": str(document.id), "path": path})
    return Added(document_id=document.id, source_path=path)


def _existing_document(exc: ConflictError) -> uuid.UUID | None:
    for detail in exc.details:
        if detail.get("document_id"):
            return uuid.UUID(str(detail["document_id"]))
    return None


def _write_meta(session: Session, candidate: ReadingCandidate, document: Document) -> None:
    if session.get(PaperMeta, document.id) is not None:
        return
    session.add(
        PaperMeta(
            document_id=document.id,
            doi=candidate.doi,
            arxiv_id=candidate.arxiv_id,
            openalex_id=candidate.openalex_id,
            venue=candidate.venue,
            year=candidate.year,
            abstract=candidate.abstract,
            cited_by_count=candidate.cited_by_count,
            source=PaperMetaSource.OPENALEX,
        )
    )
    session.commit()


def _mark_ingested(session: Session, candidate_id: uuid.UUID, document_id: uuid.UUID) -> None:
    candidate = session.get(ReadingCandidate, candidate_id)
    if candidate is None:  # deleted while downloading
        return
    candidate.status = CandidateStatus.INGESTED
    candidate.document_id = document_id
    session.add(candidate)
    session.commit()

"""`paper_enrich`: match a paper to OpenAlex and fill what the PDF could not tell us
(docs/PAPERS.md §2 `paper_meta`, §5, P7).

    paper_meta ids ──► OpenAlex work (by id, else DOI → arXiv → title + year)
        │                  │
        │                  ├─► paper_meta: venue, year, abstract, fields, counts
        │                  └─► referenced_works ─► paper_references.openalex_id / doi / arxiv_id
        │                                          (matched by DOI, arXiv id, then title)
        └─► target_document_id: this paper's references that are on the shelf, and other shelf
            papers' references that are this paper

A `source = human` row keeps every field you set; OpenAlex only fills its blanks (counts are
OpenAlex's alone and always refresh). A row that is not human becomes `source = openalex`.
Only blanks are filled on references, and a `target_document_id` already set (by
paper_structure, or by you) is never replaced. HTTP runs with the session released.

Queue it with `queue_enrich(session, document)` once paper_structure has written the
references (a paper without references still enriches its meta).
"""

import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, or_
from sqlmodel import Session, col, select

from app.db.session import release
from app.jobs.queue import JobSpec
from app.models import Document, Job, PaperMeta, PaperReference
from app.models.enums import Genre, JobKind, PaperMetaSource
from app.papers.openalex import OpenAlex, OpenAlexNotFoundError
from app.papers.shelf import ShelfIndex, load_shelf
from app.papers.works import Work, titles_match
from app.services.jobs import enqueue_or_live

logger = logging.getLogger(__name__)

# Fields a human may set (`PaperMetaUpdate`); OpenAlex never overwrites them on a human row.
_HUMAN_FIELDS = ("doi", "arxiv_id", "openalex_id", "venue", "year", "abstract", "fields")


def enrich_spec(document_id: uuid.UUID) -> JobSpec:
    """The `paper_enrich` job for a document, for an orchestrator `Plan` to enqueue."""
    return JobSpec(kind=JobKind.PAPER_ENRICH, document_id=document_id)


def queue_enrich(session: Session, document: Document) -> Job | None:
    """Queue `paper_enrich` for a paper (None for other genres). Commits."""
    if document.genre != Genre.PAPER:
        return None
    job, _ = enqueue_or_live(session, enrich_spec(document.id))
    return job


@dataclass(frozen=True, slots=True)
class EnrichOutcome:
    matched: bool
    openalex_id: str | None = None
    references_resolved: int = 0
    references_linked: int = 0
    cited_by_shelf_linked: int = 0

    def as_result(self) -> dict[str, Any]:
        return {
            "matched": self.matched,
            "openalex_id": self.openalex_id,
            "references_resolved": self.references_resolved,
            "references_linked": self.references_linked,
            "cited_by_shelf_linked": self.cited_by_shelf_linked,
        }


def enrich(session: Session, document: Document, api: OpenAlex) -> EnrichOutcome:
    """Enrich one paper's meta and references from OpenAlex; commits."""
    meta = session.get(PaperMeta, document.id)
    if meta is None:
        meta = PaperMeta(document_id=document.id, year=document.year)
        session.add(meta)
    references = list(
        session.exec(
            select(PaperReference)
            .where(PaperReference.document_id == document.id)
            .order_by(col(PaperReference.ordinal))
        )
    )
    release(session)  # OpenAlex calls below may take seconds each

    work = _find(api, meta, document)
    unresolved = [r for r in references if not r.openalex_id]
    cited = api.works_by_ids(work.referenced_works) if work and unresolved else []
    session.refresh(meta)  # a human's `PATCH /meta` during the calls must win (source = human)

    now = datetime.now(UTC)
    meta.enriched_at = meta.updated_at = now
    resolved = 0
    if work is not None:
        _apply_meta(meta, work, same_title=_same_title(document, work))
        resolved = sum(_resolve_reference(r, cited) for r in unresolved)
    session.add(meta)
    session.flush()

    shelf = load_shelf(session)
    linked = _link_references(references, shelf, document.id)
    backlinked = _link_citers(session, meta, document.id)
    for reference in references:
        session.add(reference)
    session.commit()
    outcome = EnrichOutcome(
        matched=work is not None,
        openalex_id=work.openalex_id if work else None,
        references_resolved=resolved,
        references_linked=linked,
        cited_by_shelf_linked=backlinked,
    )
    logger.info("Paper enriched", extra={"document_id": str(document.id), **outcome.as_result()})
    return outcome


def _find(api: OpenAlex, meta: PaperMeta, document: Document) -> Work | None:
    if meta.openalex_id:
        try:
            return api.work(meta.openalex_id)
        except (OpenAlexNotFoundError, ValueError):
            logger.info("Stored OpenAlex id not found", extra={"openalex_id": meta.openalex_id})
    return api.resolve(
        doi=meta.doi,
        arxiv_id=meta.arxiv_id,
        title=document.title,
        year=meta.year or document.year,
    )


def _blank(value: object) -> bool:
    return value is None or value == "" or value == []


# Taken from a work whose title is not the paper's only when the record is plainly this
# paper's (found by its own arXiv id or DOI): its ids and citation counts.
_ID_FIELDS = ("arxiv_id", "openalex_id")
# A parsed abstract is the paper's own text; OpenAlex's is rebuilt from an inverted index
# (and sometimes another paper's), so it only fills a gap.
_GAP_FILLED = ("abstract",)


def _same_title(document: Document, work: Work) -> bool:
    """Whether the OpenAlex record carries this paper's title. OpenAlex sometimes merges
    another work into a record (BERT's `W2896457183` carries a 2022 DOI, title and abstract
    of an unrelated paper beside BERT's arXiv location and citations)."""
    if not document.title or not work.title:
        return True
    return titles_match(document.title, work.title)


def _apply_meta(meta: PaperMeta, work: Work, *, same_title: bool = True) -> None:
    """Copy the work's fields onto `meta`: never over a human's value, the abstract only into
    a gap, and from a record whose title is another paper's only its ids and counts."""
    human = meta.source == PaperMetaSource.HUMAN
    if not same_title:
        logger.warning(
            "OpenAlex record has another title; keeping only its ids and counts",
            extra={"document_id": str(meta.document_id), "openalex_id": work.openalex_id,
                   "openalex_title": work.title},
        )  # fmt: skip
    found: dict[str, Any] = {
        "doi": work.doi,
        "arxiv_id": work.arxiv_id,
        "openalex_id": work.openalex_id,
        "venue": work.venue,
        "year": work.year,
        "abstract": work.abstract,
        "fields": list(work.fields),
    }
    for name in _HUMAN_FIELDS:
        value = found[name]
        if _blank(value) or (human and not _blank(getattr(meta, name))):
            continue
        if not same_title and name not in _ID_FIELDS:
            continue
        if name in _GAP_FILLED and not _blank(getattr(meta, name)):
            continue
        setattr(meta, name, value)
    meta.cited_by_count = work.cited_by_count
    if work.referenced_works:
        meta.reference_count = len(work.referenced_works)
    if not human:
        meta.source = PaperMetaSource.OPENALEX


def _resolve_reference(reference: PaperReference, cited: list[Work]) -> bool:
    """Match one bibliography entry to one of the works the paper cites; fill its blanks."""
    work = _match_work(reference, cited)
    if work is None:
        return False
    reference.openalex_id = work.openalex_id
    reference.doi = reference.doi or work.doi
    reference.arxiv_id = reference.arxiv_id or work.arxiv_id
    reference.title = reference.title or work.title
    reference.year = reference.year or work.year
    reference.venue = reference.venue or work.venue
    if not reference.authors and work.authors:
        reference.authors = list(work.authors)
    return True


def _match_work(reference: PaperReference, cited: list[Work]) -> Work | None:
    doi = (reference.doi or "").lower()
    for work in cited:
        if (doi and work.doi == doi) or (
            reference.arxiv_id and work.arxiv_id == reference.arxiv_id
        ):
            return work
    if not reference.title:
        return None
    for work in cited:
        years_agree = not (reference.year and work.year) or abs(reference.year - work.year) <= 1
        if years_agree and titles_match(reference.title, work.title):
            return work
    return None


def _link_references(
    references: list[PaperReference], shelf: ShelfIndex, document_id: uuid.UUID
) -> int:
    linked = 0
    for reference in references:
        if reference.target_document_id is not None:
            continue
        target = shelf.match(
            openalex_id=reference.openalex_id,
            doi=reference.doi,
            arxiv_id=reference.arxiv_id,
            title=reference.title,
            year=reference.year,
            exclude=document_id,
        )
        if target is not None:
            reference.target_document_id = target
            linked += 1
    return linked


def _link_citers(session: Session, meta: PaperMeta, document_id: uuid.UUID) -> int:
    """Other shelf papers' unlinked references that are this paper, by identifier."""
    clauses = []
    if meta.openalex_id:
        clauses.append(col(PaperReference.openalex_id) == meta.openalex_id)
    if meta.doi:
        clauses.append(func.lower(col(PaperReference.doi)) == meta.doi.lower())
    if meta.arxiv_id:
        clauses.append(col(PaperReference.arxiv_id) == meta.arxiv_id)
    if not clauses:
        return 0
    rows = session.exec(
        select(PaperReference).where(
            col(PaperReference.target_document_id).is_(None),
            PaperReference.document_id != document_id,
            or_(*clauses),
        )
    ).all()
    for reference in rows:
        reference.target_document_id = document_id
        session.add(reference)
    return len(rows)

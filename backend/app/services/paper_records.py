"""One paper's human records and bibliography (docs/PAPERS.md §6, §7).

    PATCH meta      your fix-up of paper_meta; the row becomes `source = human`, and
                    paper_enrich keeps every field you set (app/papers/enrich.py)
    ratings         append-only; the newest is the paper's rating (P8)
    passes          three-pass progress; PUT and DELETE are idempotent
    references      the bibliography with its shelf match and reading-candidate status

Callers pass a document already resolved by `services.papers.get_paper`.
"""

import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from sqlalchemy import delete, func, or_
from sqlmodel import Session, col, select

from app.models import Document, PaperMeta, PaperPass, PaperRating, ReadingCandidate
from app.models import PaperReference as Ref
from app.models._columns import utcnow
from app.models.enums import CitationIntent, PaperMetaSource, PaperVerdict
from app.papers.works import normalize_arxiv_id, normalize_doi, short_openalex_id
from app.services.errors import InvalidInputError

# Identifiers are stored normalized, the way enrich and the candidates match them.
_NORMALIZERS: dict[str, Callable[[str], str]] = {
    "doi": normalize_doi,
    "arxiv_id": normalize_arxiv_id,
    "openalex_id": short_openalex_id,
}
_LIST_FIELDS = ("fields", "code_urls", "data_urls")  # not null: an explicit null clears


def update_meta(session: Session, document: Document, changes: dict[str, Any]) -> PaperMeta:
    """Apply a human fix-up (only the fields sent); creates the row if the paper has none."""
    if not changes:
        raise InvalidInputError("Send at least one field to change.")
    meta = session.get(PaperMeta, document.id) or PaperMeta(
        document_id=document.id, year=document.year
    )
    for name, value in changes.items():
        if value is not None and name in _NORMALIZERS:
            try:
                value = _NORMALIZERS[name](value)
            except ValueError as error:
                raise InvalidInputError(str(error), field=f"body.{name}") from error
        if value is None and name in _LIST_FIELDS:
            value = []
        setattr(meta, name, value)
    meta.source = PaperMetaSource.HUMAN
    meta.updated_at = utcnow()
    session.add(meta)
    session.commit()
    session.refresh(meta)
    return meta


# --- ratings -------------------------------------------------------------------------


def add_rating(
    session: Session,
    document: Document,
    *,
    stars: int,
    verdict: PaperVerdict | None,
    note: str | None,
) -> PaperRating:
    """A new rating; older ones stay as history (the table refuses updates)."""
    rating = PaperRating(document_id=document.id, stars=stars, verdict=verdict, note=note)
    session.add(rating)
    session.commit()
    session.refresh(rating)
    return rating


def rating_history(session: Session, document: Document) -> list[PaperRating]:
    """Every rating of the paper, newest (the current one) first."""
    return list(
        session.exec(
            select(PaperRating)
            .where(PaperRating.document_id == document.id)
            .order_by(col(PaperRating.created_at).desc(), col(PaperRating.id).desc())
        )
    )


# --- passes --------------------------------------------------------------------------


def _pass(session: Session, document: Document, number: int) -> PaperPass | None:
    return session.exec(
        select(PaperPass).where(PaperPass.document_id == document.id, PaperPass.pass_ == number)
    ).first()


def complete_pass(
    session: Session, document: Document, number: int, *, note: str | None
) -> PaperPass:
    """Mark pass `number` done. Repeating it keeps the first `completed_at` and sets `note`."""
    done = _pass(session, document, number)
    if done is None:
        done = PaperPass(document_id=document.id, pass_=number)
    done.note = note
    session.add(done)
    session.commit()
    session.refresh(done)
    return done


def undo_pass(session: Session, document: Document, number: int) -> None:
    """Forget pass `number` (no-op when it was not done)."""
    session.execute(
        delete(PaperPass).where(
            col(PaperPass.document_id) == document.id, col(PaperPass.pass_) == number
        )
    )
    session.commit()


# --- references ----------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class ShelfDoc:
    id: uuid.UUID
    slug: str
    title: str


@dataclass(frozen=True, slots=True)
class ReferenceRow:
    reference: Ref
    target: ShelfDoc | None
    candidate: ReadingCandidate | None


def _candidates(session: Session, refs: list[Ref]) -> dict[tuple[str, str], ReadingCandidate]:
    """Candidates keyed by ("openalex" | "doi" | "arxiv", id), for refs that have ids."""
    openalex = {r.openalex_id for r in refs if r.openalex_id}
    dois = {r.doi.lower() for r in refs if r.doi}
    arxiv = {r.arxiv_id for r in refs if r.arxiv_id}
    if not (openalex or dois or arxiv):
        return {}
    rows = session.exec(
        select(ReadingCandidate).where(
            or_(
                col(ReadingCandidate.openalex_id).in_(openalex),
                func.lower(col(ReadingCandidate.doi)).in_(dois),
                col(ReadingCandidate.arxiv_id).in_(arxiv),
            )
        )
    ).all()
    found: dict[tuple[str, str], ReadingCandidate] = {}
    for row in rows:
        for key in (
            ("openalex", row.openalex_id),
            ("doi", row.doi.lower() if row.doi else None),
            ("arxiv", row.arxiv_id),
        ):
            if key[1]:
                found.setdefault((key[0], key[1]), row)
    return found


def _candidate_for(
    ref: Ref, found: dict[tuple[str, str], ReadingCandidate]
) -> ReadingCandidate | None:
    keys = [
        ("openalex", ref.openalex_id),
        ("doi", ref.doi.lower() if ref.doi else None),
        ("arxiv", ref.arxiv_id),
    ]
    return next((found[(k, v)] for k, v in keys if v and (k, v) in found), None)


def list_references(
    session: Session,
    document: Document,
    *,
    intent: CitationIntent | None = None,
    on_shelf: bool | None = None,
) -> list[ReferenceRow]:
    """The bibliography in order, each entry with its shelf document and candidate."""
    query = select(Ref).where(Ref.document_id == document.id)
    if intent is not None:
        query = query.where(Ref.intent == intent)
    if on_shelf is not None:
        target = col(Ref.target_document_id)
        query = query.where(target.is_not(None) if on_shelf else target.is_(None))
    refs = list(session.exec(query.order_by(col(Ref.ordinal))))

    target_ids = {r.target_document_id for r in refs if r.target_document_id}
    shelf = (
        {
            doc_id: ShelfDoc(doc_id, slug, title)
            for doc_id, slug, title in session.exec(
                select(Document.id, Document.slug, Document.title).where(
                    col(Document.id).in_(target_ids)
                )
            )
        }
        if target_ids
        else {}
    )
    found = _candidates(session, refs)
    return [
        ReferenceRow(
            reference=r,
            target=shelf.get(r.target_document_id) if r.target_document_id else None,
            candidate=_candidate_for(r, found),
        )
        for r in refs
    ]

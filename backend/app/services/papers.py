"""The paper shelf behind `/papers` and `/papers/{ref}` (docs/PAPERS.md §7).

A paper is a document with `genre = 'paper'` (P1). A listing is one filtered id query, then
a fixed number of batched reads for the page (meta, latest ratings, passes, artifacts,
counts): never one query per paper.

    documents ─┬─ paper_meta                    venue, year, ids, counts
               ├─ latest paper_ratings row      stars, verdict  (P8: latest wins)
               ├─ max(paper_passes.pass)        highest completed pass
               ├─ artifacts (paper types)       which exist, which are approved
               └─ paper_references / claims     counts
"""

import uuid
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from sqlalchemy import ColumnElement, Select, func, or_
from sqlalchemy import select as sa_select
from sqlalchemy.orm import aliased
from sqlmodel import Session, col, select

from app.core.errors import NotFoundError
from app.models import Artifact, Claim, Document, PaperMeta, PaperPass, PaperRating
from app.models import PaperReference as Ref
from app.models.enums import ArtifactType, DocumentStatus, Genre, PaperVerdict, Review
from app.services.documents import get_document
from app.services.sql import contains_pattern

PAPER_ARTIFACT_TYPES = (
    ArtifactType.PAPER_CARD,
    ArtifactType.PAPER_EXPLAINER,
    ArtifactType.CLAIM_SET,
    ArtifactType.RESULTS_TABLE,
    ArtifactType.CITATION_INTENTS,
    ArtifactType.PAPER_ASSESSMENT,
    ArtifactType.PAPER_REVIEW,
    ArtifactType.NOTATION_TABLE,
    ArtifactType.JOURNAL_CLUB,
    ArtifactType.MATH_EXPLAINER,
)
SORTS = ("recent", "title", "year", "stars", "cited_by")


def get_paper(session: Session, ref: str) -> Document:
    """A document by uuid or slug that is a paper; 404 otherwise."""
    document = get_document(session, ref)
    if document.genre != Genre.PAPER:
        raise NotFoundError(f"Paper {ref} does not exist.")
    return document


# --- facts for a page of papers ------------------------------------------------------


@dataclass(frozen=True, slots=True)
class ArtifactState:
    type: ArtifactType
    variant: str | None
    artifact_id: uuid.UUID
    review: Review
    created_at: datetime


@dataclass(slots=True)
class Counts:
    references: int = 0
    references_on_shelf: int = 0
    claims: int = 0


@dataclass(slots=True)
class PaperFacts:
    document: Document
    meta: PaperMeta | None = None
    rating: PaperRating | None = None
    passes: list[PaperPass] = field(default_factory=list)
    artifacts: list[ArtifactState] = field(default_factory=list)
    counts: Counts = field(default_factory=Counts)


def _latest_ratings() -> Select[Any]:
    """`DISTINCT ON (document_id)`: each paper's newest rating (append-only, latest wins)."""
    return (
        select(PaperRating)
        .distinct(col(PaperRating.document_id))
        .order_by(
            col(PaperRating.document_id),
            col(PaperRating.created_at).desc(),
            col(PaperRating.id).desc(),
        )
    )


def _preferred(rows: Sequence[Any]) -> list[ArtifactState]:
    """Per (type, variant): the latest approved, else the latest draft / needs_review.
    `rows` come newest first."""
    best: dict[tuple[ArtifactType, str | None], ArtifactState] = {}
    for row in rows:
        key = (row.type, row.variant)
        current = best.get(key)
        if current is None or (current.review != Review.APPROVED and row.review == Review.APPROVED):
            best[key] = ArtifactState(row.type, row.variant, row.id, row.review, row.created_at)
    order = {t: i for i, t in enumerate(PAPER_ARTIFACT_TYPES)}
    return sorted(best.values(), key=lambda a: (order[a.type], a.variant or ""))


def paper_facts(session: Session, ids: Sequence[uuid.UUID]) -> list[PaperFacts]:
    """Everything a shelf row shows, for `ids` in their order, in seven queries."""
    if not ids:
        return []
    docs = session.exec(select(Document).where(col(Document.id).in_(ids))).all()
    facts = {d.id: PaperFacts(document=d) for d in docs}
    for meta in session.exec(select(PaperMeta).where(col(PaperMeta.document_id).in_(ids))):
        facts[meta.document_id].meta = meta
    ratings = _latest_ratings().where(col(PaperRating.document_id).in_(ids))
    for rating in session.exec(ratings):  # type: ignore[call-overload]
        facts[rating.document_id].rating = rating
    passes = select(PaperPass).where(col(PaperPass.document_id).in_(ids))
    for done in session.exec(passes.order_by(col(PaperPass.pass_))):
        facts[done.document_id].passes.append(done)

    artifact_rows = session.execute(
        sa_select(
            col(Artifact.id),
            col(Artifact.document_id),
            col(Artifact.type),
            col(Artifact.variant),
            col(Artifact.review),
            col(Artifact.created_at),
        )
        .where(
            col(Artifact.document_id).in_(ids),
            col(Artifact.type).in_(PAPER_ARTIFACT_TYPES),
            col(Artifact.review) != Review.REJECTED,
            col(Artifact.anchor).is_(None),
            col(Artifact.note_id).is_(None),
        )
        .order_by(col(Artifact.created_at).desc(), col(Artifact.id).desc())
    ).all()
    by_doc: dict[uuid.UUID, list[Any]] = defaultdict(list)
    for row in artifact_rows:
        by_doc[row.document_id].append(row)
    for doc_id, rows in by_doc.items():
        facts[doc_id].artifacts = _preferred(rows)

    ref_counts = session.exec(
        select(Ref.document_id, func.count(), func.count(col(Ref.target_document_id)))
        .where(col(Ref.document_id).in_(ids))
        .group_by(col(Ref.document_id))
    )
    for doc_id, total, on_shelf in ref_counts:
        facts[doc_id].counts.references = total
        facts[doc_id].counts.references_on_shelf = on_shelf
    claim_counts = session.exec(
        select(Claim.document_id, func.count())
        .where(col(Claim.document_id).in_(ids))
        .group_by(col(Claim.document_id))
    )
    for doc_id, total in claim_counts:
        facts[doc_id].counts.claims = total
    return [facts[i] for i in ids if i in facts]


def get_facts(session: Session, ref: str) -> PaperFacts:
    return paper_facts(session, [get_paper(session, ref).id])[0]


# --- the listing -----------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class PaperFilters:
    q: str | None = None  # title or author substring
    venue: str | None = None  # exact, case-insensitive
    year: int | None = None  # paper_meta.year, else documents.year
    min_stars: int | None = None  # latest rating
    pass_: int | None = None  # highest completed pass; 0 = none yet
    verdict: PaperVerdict | None = None  # latest rating
    status: DocumentStatus | None = None
    sort: str = "recent"


def _year() -> ColumnElement[Any]:
    return func.coalesce(col(PaperMeta.year), col(Document.year))


def _shelf() -> Select[Any]:
    """Paper ids joined to their meta, newest rating and highest pass (as `r` / `top`)."""
    latest = aliased(PaperRating, _latest_ratings().subquery(), name="r")
    top = (
        select(PaperPass.document_id, func.max(col(PaperPass.pass_)).label("top"))
        .group_by(col(PaperPass.document_id))
        .subquery("p")
    )
    query = (
        select(col(Document.id), latest.stars, latest.verdict, top.c.top)
        .select_from(Document)
        .outerjoin(PaperMeta, col(PaperMeta.document_id) == Document.id)
        .outerjoin(latest, col(latest.document_id) == Document.id)
        .outerjoin(top, top.c.document_id == Document.id)
        .where(Document.genre == Genre.PAPER)
    )
    return query


def _filtered(query: Select[Any], filters: PaperFilters) -> Select[Any]:
    stars, verdict, top = (query.selected_columns[i] for i in (1, 2, 3))
    if filters.q:
        pattern = contains_pattern(filters.q)
        authors = func.array_to_string(col(Document.authors), " ")
        query = query.where(
            or_(
                col(Document.title).ilike(pattern, escape="\\"),
                authors.ilike(pattern, escape="\\"),
            )
        )
    if filters.venue:
        query = query.where(func.lower(col(PaperMeta.venue)) == filters.venue.strip().lower())
    if filters.year is not None:
        query = query.where(_year() == filters.year)
    if filters.min_stars is not None:
        query = query.where(stars >= filters.min_stars)
    if filters.verdict is not None:
        query = query.where(verdict == filters.verdict)
    if filters.pass_ == 0:
        query = query.where(top.is_(None))
    elif filters.pass_ is not None:
        query = query.where(top == filters.pass_)
    if filters.status is not None:
        query = query.where(col(Document.status) == filters.status)
    return query


def _ordered(query: Select[Any], sort: str) -> Select[Any]:
    stars = query.selected_columns[1]
    keys: dict[str, list[Any]] = {
        "recent": [],
        "title": [func.lower(col(Document.title))],
        "year": [_year().desc().nulls_last()],
        "stars": [stars.desc().nulls_last()],
        "cited_by": [col(PaperMeta.cited_by_count).desc().nulls_last()],
    }
    return query.order_by(*keys[sort], col(Document.created_at).desc(), col(Document.id))


def list_papers(
    session: Session, filters: PaperFilters, *, limit: int, offset: int
) -> tuple[list[PaperFacts], int]:
    """One page of papers and the total match count."""
    query = _filtered(_shelf(), filters)
    total = session.exec(select(func.count()).select_from(query.subquery())).one()
    page = _ordered(query, filters.sort).limit(limit).offset(offset)
    ids = [row[0] for row in session.exec(page)]  # type: ignore[call-overload]
    return paper_facts(session, ids), int(total)


def facets(session: Session) -> dict[str, list[tuple[str | int, int]]]:
    """Venue and year counts over every paper, for the filter bar."""
    papers = col(Document.genre) == Genre.PAPER
    venue_count = func.count().label("n")
    venues = session.exec(
        select(PaperMeta.venue, venue_count)
        .join(Document, col(Document.id) == PaperMeta.document_id)
        .where(papers, col(PaperMeta.venue).is_not(None))
        .group_by(col(PaperMeta.venue))
        .order_by(venue_count.desc(), col(PaperMeta.venue))
    ).all()
    year = _year()
    years = session.exec(
        select(year, func.count())
        .select_from(Document)
        .outerjoin(PaperMeta, col(PaperMeta.document_id) == Document.id)
        .where(papers, year.is_not(None))
        .group_by(year)
        .order_by(year.desc())
    ).all()
    return {
        "venues": [(v, n) for v, n in venues if v is not None],
        "years": [(int(y), n) for y, n in years],
    }

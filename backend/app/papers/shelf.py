"""Read-side helpers shared by enrich, candidates and watch: the papers on your shelf, their
identifiers, and your latest rating of each.

`ShelfIndex.match` answers "is this work already on the shelf?" by OpenAlex id, DOI or
arXiv id, then by a close title (with years, when both are known, at most one apart).
Snapshots are plain frozen dataclasses, so they stay valid after the session is released
for slow HTTP work.
"""

import uuid
from collections.abc import Iterable
from dataclasses import dataclass

from sqlmodel import Session, col, select

from app.models import Document, PaperMeta, PaperRating
from app.models.enums import Genre
from app.papers.works import titles_match

WATCH_MIN_STARS = 4  # papers you rated this high are watched and seed "similar"


@dataclass(frozen=True, slots=True)
class ShelfPaper:
    document_id: uuid.UUID
    title: str
    year: int | None
    openalex_id: str | None
    doi: str | None
    arxiv_id: str | None
    abstract: str | None


@dataclass(frozen=True, slots=True)
class ShelfIndex:
    papers: tuple[ShelfPaper, ...]

    def match(
        self,
        *,
        openalex_id: str | None = None,
        doi: str | None = None,
        arxiv_id: str | None = None,
        title: str | None = None,
        year: int | None = None,
        exclude: uuid.UUID | None = None,
    ) -> uuid.UUID | None:
        """The shelf paper this work is, or None. `exclude`: never match that document."""
        papers = [p for p in self.papers if p.document_id != exclude]
        for paper in papers:
            if (
                (openalex_id and paper.openalex_id == openalex_id)
                or (doi and paper.doi and paper.doi.lower() == doi.lower())
                or (arxiv_id and paper.arxiv_id == arxiv_id)
            ):
                return paper.document_id
        if title:
            for paper in papers:
                if _years_agree(year, paper.year) and titles_match(title, paper.title):
                    return paper.document_id
        return None

    def by_id(self, document_id: uuid.UUID) -> ShelfPaper | None:
        return next((p for p in self.papers if p.document_id == document_id), None)


def load_shelf(session: Session) -> ShelfIndex:
    """Every `genre = paper` document with its `paper_meta` identifiers (if any)."""
    rows = session.exec(
        select(Document, PaperMeta)
        .join(PaperMeta, col(PaperMeta.document_id) == col(Document.id), isouter=True)
        .where(Document.genre == Genre.PAPER)
        .order_by(col(Document.created_at), col(Document.id))
    ).all()
    return ShelfIndex(
        papers=tuple(
            ShelfPaper(
                document_id=document.id,
                title=document.title,
                year=(meta.year if meta and meta.year else None) or document.year,
                openalex_id=meta.openalex_id if meta else None,
                doi=meta.doi if meta else None,
                arxiv_id=meta.arxiv_id if meta else None,
                abstract=meta.abstract if meta else None,
            )
            for document, meta in rows
        )
    )


def latest_ratings(
    session: Session, document_ids: Iterable[uuid.UUID] | None = None
) -> dict[uuid.UUID, int]:
    """Your latest stars per document (ratings are append-only; the newest wins)."""
    query = select(PaperRating).order_by(
        col(PaperRating.document_id),
        col(PaperRating.created_at).desc(),
        col(PaperRating.id).desc(),  # the same tie-break as the shelf (services.papers)
    )
    if document_ids is not None:
        query = query.where(col(PaperRating.document_id).in_(list(document_ids)))
    latest: dict[uuid.UUID, int] = {}
    for rating in session.exec(query):
        latest.setdefault(rating.document_id, rating.stars)
    return latest


def watched(ratings: dict[uuid.UUID, int]) -> list[uuid.UUID]:
    """Documents whose latest rating is at least `WATCH_MIN_STARS`, in a stable order."""
    return sorted(d for d, stars in ratings.items() if stars >= WATCH_MIN_STARS)


def _years_agree(a: int | None, b: int | None) -> bool:
    return a is None or b is None or abs(a - b) <= 1

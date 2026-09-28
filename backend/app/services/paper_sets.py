"""Paper sets and their syntheses behind `/paper-sets` (docs/PAPERS.md §7).

A set is a named, ordered list of papers (deduplicated, 1-100, each a `genre = paper`
document). Deleting a set deletes its syntheses. A synthesis is written by the
`synthesize_papers` job; reads resolve its `<slug>:<anchor>` cites through `sources`.

Which synthesis `GET` serves without `?version=`: the latest approved, else the latest
draft (a rejected version is only served by number), the house rule for artifacts (§7).
"""

import uuid

from sqlmodel import Session, col, func, select

from app.core.errors import NotFoundError
from app.jobs.queue import JobSpec
from app.models import Document, Job, PaperSet, PaperSynthesis
from app.models.enums import Genre, JobKind, Review
from app.papers.synthesis import MIN_MEMBERS
from app.retrieval.evidence import split_cite
from app.schemas.search import CiteSource, DocumentRef
from app.services.errors import InvalidInputError
from app.services.jobs import enqueue_or_live

SYNTHESIS_PRIORITY = 100
VERDICTS = {"approve": Review.APPROVED, "reject": Review.REJECTED}


def create_set(session: Session, name: str, document_ids: list[uuid.UUID]) -> PaperSet:
    """A new set of papers, in the given order (duplicates dropped). Commits."""
    ids = list(dict.fromkeys(document_ids))
    papers = set(
        session.exec(
            select(Document.id).where(col(Document.id).in_(ids), Document.genre == Genre.PAPER)
        ).all()
    )
    if missing := [str(i) for i in ids if i not in papers]:
        raise InvalidInputError(
            f"Not papers on the shelf: {', '.join(missing)}.", field="body.document_ids"
        )
    paper_set = PaperSet(name=name, document_ids=ids)
    session.add(paper_set)
    session.commit()
    session.refresh(paper_set)
    return paper_set


def list_sets(session: Session, *, limit: int, offset: int) -> tuple[list[PaperSet], int]:
    """Newest first."""
    total = session.exec(select(func.count()).select_from(PaperSet)).one()
    rows = session.exec(
        select(PaperSet)
        .order_by(col(PaperSet.created_at).desc(), col(PaperSet.id))
        .limit(limit)
        .offset(offset)
    ).all()
    return list(rows), int(total)


def get_set(session: Session, set_id: uuid.UUID) -> PaperSet:
    paper_set = session.get(PaperSet, set_id)
    if paper_set is None:
        raise NotFoundError(f"Paper set {set_id} does not exist.")
    return paper_set


def delete_set(session: Session, set_id: uuid.UUID) -> None:
    """Deletes the set and (by cascade) its syntheses; a missing set is fine."""
    paper_set = session.get(PaperSet, set_id)
    if paper_set is not None:
        session.delete(paper_set)
        session.commit()


def queue_synthesis(session: Session, set_id: uuid.UUID, *, force: bool = False) -> Job:
    """Queue `synthesize_papers`, or return the live job for this set."""
    paper_set = get_set(session, set_id)
    present = session.exec(
        select(func.count())
        .select_from(Document)
        .where(col(Document.id).in_(paper_set.document_ids))
    ).one()
    if present < MIN_MEMBERS:
        raise InvalidInputError(
            f"A synthesis needs at least {MIN_MEMBERS} papers; this set has {present}.",
            field="set_id",
        )
    payload: dict[str, object] = {"set_id": str(set_id)}
    if force:
        payload["force"] = True
    # A force must not fold into a live plain run, which would keep the unchanged version.
    spec = JobSpec(
        kind=JobKind.SYNTHESIZE_PAPERS,
        input_hash=f"set:{set_id}:force" if force else f"set:{set_id}",
        payload=payload,
        priority=SYNTHESIS_PRIORITY,
    )
    job, _ = enqueue_or_live(session, spec)
    return job


def latest_version(session: Session, set_id: uuid.UUID) -> PaperSynthesis | None:
    rows = session.exec(
        select(PaperSynthesis)
        .where(PaperSynthesis.set_id == set_id, PaperSynthesis.review != Review.REJECTED)
        .order_by(col(PaperSynthesis.version).desc())
    ).all()
    return next((r for r in rows if r.review is Review.APPROVED), rows[0] if rows else None)


def get_synthesis(
    session: Session, set_id: uuid.UUID, version: int | None = None
) -> PaperSynthesis:
    get_set(session, set_id)
    if version is None:
        row = latest_version(session, set_id)
    else:
        row = session.exec(
            select(PaperSynthesis).where(
                PaperSynthesis.set_id == set_id, PaperSynthesis.version == version
            )
        ).first()
    if row is None:
        which = f"version {version}" if version is not None else "a synthesis"
        raise NotFoundError(f"Paper set {set_id} has no {which} yet.")
    return row


def review_synthesis(
    session: Session, set_id: uuid.UUID, version: int, verdict: str
) -> PaperSynthesis:
    """Approve or reject one version. Commits."""
    row = get_synthesis(session, set_id, version)
    row.review = VERDICTS[verdict]
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def sources(session: Session, citations: list[str]) -> dict[str, CiteSource]:
    """What each `<slug>:<anchor>` cite points at (cites of deleted papers are left out)."""
    pairs = {c: split_cite(c) for c in citations}
    slugs = {slug for slug, _ in pairs.values() if slug}
    documents = {
        d.slug: DocumentRef(id=d.id, slug=d.slug, title=d.title, authors=d.authors)
        for d in session.exec(select(Document).where(col(Document.slug).in_(slugs)))
    }
    return {
        cite: CiteSource(document=documents[slug], anchor=anchor)
        for cite, (slug, anchor) in sorted(pairs.items())
        if slug in documents
    }

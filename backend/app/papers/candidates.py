"""`paper_candidates`: gather what to read next from your shelf of papers and score it
(docs/PAPERS.md §5 "Recommendations", P6, P7).

    shelf papers ─┬─ paper_references not on the shelf ........ reference (backward)
                  ├─ OpenAlex referenced_works ................. reference (backward)
                  ├─ OpenAlex works citing them ................ cited_by  (forward)
                  ├─ OpenAlex related_works .................... related
                  └─ reading_candidates found by the watch list  watch (kept on rebuild)
    abstract embedding close to a paper you rated >= 4 ......... similar (+ similarity term)
        → drop anything already on the shelf → scoring.rank → candidate_store.save

Everything is keyed by OpenAlex id when known, else DOI, arXiv id, then normalized title,
so the same work reached several ways is one candidate with several sources. Reads happen
first; the session is released for the HTTP and embedding work; `save` writes last.
"""

import logging
import math
import uuid
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime

from sqlmodel import Session, col, select

from app.db.session import release
from app.models import PaperReference, ReadingCandidate
from app.models.enums import CandidateSource
from app.papers.openalex import OpenAlex
from app.papers.scoring import CandidateFacts, Scored, Source, rank
from app.papers.shelf import ShelfIndex, latest_ratings, load_shelf, watched
from app.papers.works import Work, title_key
from app.retrieval.embedding import Embedder

logger = logging.getLogger(__name__)

CITING_PER_PAPER = 25  # newest works citing each shelf paper
SIMILAR_THRESHOLD = 0.75  # cosine to a >= 4-star abstract that adds a `similar` source
MAX_EMBEDDED = 400  # candidate abstracts embedded per rebuild


@dataclass(slots=True)
class Entry:
    """A candidate being assembled from every path that reaches it."""

    key: str
    title: str
    openalex_id: str | None = None
    doi: str | None = None
    arxiv_id: str | None = None
    authors: list[str] = field(default_factory=list)
    year: int | None = None
    venue: str | None = None
    abstract: str | None = None
    pdf_url: str | None = None
    cited_by_count: int | None = None
    sources: set[tuple[str, uuid.UUID | None]] = field(default_factory=set)
    citers: set[uuid.UUID] = field(default_factory=set)
    intents: list[str] = field(default_factory=list)
    similarity: float | None = None
    title_from_raw: bool = False  # a placeholder from the raw reference string

    def absorb(self, work: Work) -> None:
        """Fill blanks from OpenAlex; its counts and OA link always win."""
        if self.title_from_raw:
            self.title, self.title_from_raw = work.title, False
        self.openalex_id = self.openalex_id or work.openalex_id
        self.doi = self.doi or work.doi
        self.arxiv_id = self.arxiv_id or work.arxiv_id
        self.authors = self.authors or list(work.authors)
        self.year = self.year or work.year
        self.venue = self.venue or work.venue
        self.abstract = self.abstract or work.abstract
        self.pdf_url = work.pdf_url or self.pdf_url
        self.cited_by_count = work.cited_by_count

    def facts(self) -> CandidateFacts:
        return CandidateFacts(
            key=self.key,
            sources=tuple(Source(kind, doc) for kind, doc in sorted(self.sources, key=str)),
            shelf_citers=len(self.citers),
            intents=tuple(sorted(self.intents)),
            cited_by_count=self.cited_by_count,
            year=self.year,
            similarity=self.similarity,
        )


def aliases(
    *, openalex_id: str | None, doi: str | None, arxiv_id: str | None, title: str | None
) -> list[str]:
    """Every key a work is known by, strongest first: OpenAlex id, DOI, arXiv id, title."""
    keys = [
        openalex_id or "",
        f"doi:{doi.lower()}" if doi else "",
        f"arxiv:{arxiv_id}" if arxiv_id else "",
        f"title:{t}" if (t := title_key(title or "")) else "",
    ]
    return [k for k in keys if k]


class Pool:
    """Entries by any alias, so one work reached by id in one place and by title in another
    is a single candidate."""

    def __init__(self) -> None:
        self.entries: dict[str, Entry] = {}
        self._aliases: dict[str, Entry] = {}

    def get(self, *, title: str, openalex_id: str | None = None, doi: str | None = None,
            arxiv_id: str | None = None) -> Entry | None:  # fmt: skip
        keys = aliases(openalex_id=openalex_id, doi=doi, arxiv_id=arxiv_id, title=title)
        if not keys:
            return None
        entry = next((self._aliases[k] for k in keys if k in self._aliases), None)
        if entry is None:
            entry = Entry(key=keys[0], title=title)
            self.entries[entry.key] = entry
        entry.openalex_id = entry.openalex_id or openalex_id
        entry.doi = entry.doi or doi
        entry.arxiv_id = entry.arxiv_id or arxiv_id
        for key in keys:
            self._aliases.setdefault(key, entry)
        return entry

    def add_work(self, work: Work, kind: str, document_id: uuid.UUID) -> Entry | None:
        entry = self.get(
            title=work.title, openalex_id=work.openalex_id, doi=work.doi, arxiv_id=work.arxiv_id
        )
        if entry is not None:
            entry.absorb(work)
            entry.sources.add((kind, document_id))
        return entry


@dataclass(frozen=True, slots=True)
class Rebuild:
    scored: list[Scored]
    entries: dict[str, Entry]


def build(
    session: Session,
    api: OpenAlex,
    embedder: Embedder | None = None,
    *,
    now: datetime | None = None,
) -> Rebuild:
    """Read the shelf, ask OpenAlex, score; nothing is written (see `candidate_store.save`)."""
    shelf = load_shelf(session)
    ratings = latest_ratings(session)
    pool = Pool()
    _add_parsed_references(session, shelf, pool)
    _add_watch_rows(session, pool)
    release(session)

    shelf_ids = {p.openalex_id: p.document_id for p in shelf.papers if p.openalex_id}
    shelf_works = api.works_by_ids(shelf_ids)
    _add_linked(api, pool, shelf_works, shelf_ids, "referenced_works", CandidateSource.REFERENCE)
    _add_linked(api, pool, shelf_works, shelf_ids, "related_works", CandidateSource.RELATED)
    for work in shelf_works:
        for citer in api.citing(work.openalex_id, limit=CITING_PER_PAPER):
            pool.add_work(citer, CandidateSource.CITED_BY, shelf_ids[work.openalex_id])
    _fill_metadata(api, pool)

    entries = {k: e for k, e in pool.entries.items() if not _on_shelf(e, shelf)}
    if embedder is not None:
        _add_similarity(embedder, entries.values(), shelf, ratings)
    year = (now or datetime.now(UTC)).year
    scored = rank((e.facts() for e in entries.values()), ratings=ratings, current_year=year)
    logger.info("Candidates scored", extra={"candidates": len(scored)})
    return Rebuild(scored=scored, entries=entries)


def _add_parsed_references(session: Session, shelf: ShelfIndex, pool: Pool) -> None:
    shelf_ids = [p.document_id for p in shelf.papers]
    if not shelf_ids:
        return
    references = session.exec(
        select(PaperReference)
        .where(
            col(PaperReference.document_id).in_(shelf_ids),
            col(PaperReference.target_document_id).is_(None),
        )
        .order_by(col(PaperReference.document_id), col(PaperReference.ordinal))
    )
    for ref in references:
        if not ref.title and not ref.openalex_id:  # a raw string alone is too weak to suggest
            continue
        entry = pool.get(
            title=ref.title or ref.raw[:300],
            openalex_id=ref.openalex_id,
            doi=ref.doi,
            arxiv_id=ref.arxiv_id,
        )
        if entry is None:
            continue
        if not entry.sources and not ref.title:
            entry.title_from_raw = True
        elif ref.title and entry.title_from_raw:
            entry.title, entry.title_from_raw = ref.title, False
        entry.authors = entry.authors or list(ref.authors)
        entry.year = entry.year or ref.year
        entry.venue = entry.venue or ref.venue
        entry.sources.add((CandidateSource.REFERENCE, ref.document_id))
        if ref.document_id not in entry.citers:
            entry.citers.add(ref.document_id)
            if ref.intent is not None:
                entry.intents.append(ref.intent)


def _add_watch_rows(session: Session, pool: Pool) -> None:
    """Candidates the watch list found keep their `watch` sources across rebuilds."""
    for row in session.exec(select(ReadingCandidate).order_by(col(ReadingCandidate.created_at))):
        watch = [s for s in row.sources if s.get("kind") == CandidateSource.WATCH]
        if not watch:
            continue
        entry = pool.get(
            title=row.title, openalex_id=row.openalex_id, doi=row.doi, arxiv_id=row.arxiv_id
        )
        if entry is None:
            continue
        entry.authors = entry.authors or list(row.authors)
        entry.year = entry.year or row.year
        entry.venue, entry.abstract = entry.venue or row.venue, entry.abstract or row.abstract
        entry.pdf_url = entry.pdf_url or row.pdf_url
        entry.cited_by_count = entry.cited_by_count or row.cited_by_count
        for source in watch:
            doc = source.get("document_id")
            entry.sources.add((CandidateSource.WATCH, uuid.UUID(str(doc)) if doc else None))


def _add_linked(
    api: OpenAlex,
    pool: Pool,
    shelf_works: list[Work],
    shelf_ids: dict[str, uuid.UUID],
    attribute: str,
    kind: CandidateSource,
) -> None:
    """Resolve every shelf work's `referenced_works` / `related_works` in batches."""
    by_target: dict[str, list[uuid.UUID]] = {}
    for work in shelf_works:
        for target in getattr(work, attribute):
            by_target.setdefault(target, []).append(shelf_ids[work.openalex_id])
    for found in api.works_by_ids(by_target):
        for document_id in by_target[found.openalex_id]:
            entry = pool.add_work(found, kind, document_id)
            if entry is not None and kind == CandidateSource.REFERENCE:
                entry.citers.add(document_id)


def _fill_metadata(api: OpenAlex, pool: Pool) -> None:
    """OpenAlex counts and abstracts for entries known only from parsed references."""
    missing = {
        e.openalex_id: e
        for e in pool.entries.values()
        if e.openalex_id and e.cited_by_count is None
    }
    for work in api.works_by_ids(missing):
        missing[work.openalex_id].absorb(work)


def _on_shelf(entry: Entry, shelf: ShelfIndex) -> bool:
    return (
        shelf.match(
            openalex_id=entry.openalex_id,
            doi=entry.doi,
            arxiv_id=entry.arxiv_id,
            title=entry.title,
            year=entry.year,
        )
        is not None
    )


def _add_similarity(
    embedder: Embedder,
    entries: Iterable[Entry],
    shelf: ShelfIndex,
    ratings: dict[uuid.UUID, int],
) -> None:
    liked = [p for d in watched(ratings) if (p := shelf.by_id(d)) is not None and p.abstract]
    with_abstract = sorted((e for e in entries if e.abstract), key=lambda e: e.key)[:MAX_EMBEDDED]
    if not liked or not with_abstract:
        return
    seeds = embedder.dense([p.abstract or "" for p in liked])
    vectors = embedder.dense([e.abstract or "" for e in with_abstract])
    for entry, vector in zip(with_abstract, vectors, strict=True):
        best, nearest = max(
            ((_cosine(vector, seed), p.document_id) for seed, p in zip(seeds, liked, strict=True)),
            key=lambda pair: (pair[0], str(pair[1])),
        )
        entry.similarity = round(best, 6)
        if best >= SIMILAR_THRESHOLD:
            entry.sources.add((CandidateSource.SIMILAR, nearest))


def _cosine(a: Sequence[float], b: Sequence[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b, strict=True))
    norm = math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b))
    return dot / norm if norm else 0.0

"""Writes `reading_candidates` from a rebuild or the watch list (docs/PAPERS.md §2, §5).

Upsert rules:
- a row is found by any alias (OpenAlex id, DOI, arXiv id, normalized title);
- a found row gets fresh metadata, sources, `score` and `score_parts`, but its `status`
  never changes here: `dismissed` stays dismissed (never resurrected), `queued` stays
  queued, `ingested` stays ingested;
- a `suggested` row the rebuild no longer reaches is deleted, unless the watch list found it;
- `queue_recommend_next` hands the top N to `recommend_next`, only once that kind has a
  handler (the skill is written separately; until then this is a no-op).
"""

import hashlib
import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

from sqlmodel import Session, col, select

from app.jobs import queue
from app.jobs.queue import JobSpec
from app.jobs.registry import get_handler
from app.models import Job, ReadingCandidate
from app.models.enums import CandidateSource, CandidateStatus, JobKind
from app.papers.candidates import Entry, Rebuild, aliases
from app.papers.scoring import CandidateFacts, Scored, Source, score
from app.papers.works import Work

STORE_LIMIT = 300  # best-scored candidates kept per rebuild
RECOMMEND_TOP_N = 10
_LIVE = (CandidateStatus.SUGGESTED, CandidateStatus.QUEUED)


class RowIndex:
    def __init__(self, rows: Iterable[ReadingCandidate]) -> None:
        self._by_alias: dict[str, ReadingCandidate] = {}
        for row in rows:
            self.add(row)

    def add(self, row: ReadingCandidate) -> None:
        for key in _row_aliases(row):
            self._by_alias.setdefault(key, row)

    def find(
        self, *, title: str, openalex_id: str | None, doi: str | None, arxiv_id: str | None
    ) -> ReadingCandidate | None:
        keys = aliases(openalex_id=openalex_id, doi=doi, arxiv_id=arxiv_id, title=title)
        return next((self._by_alias[k] for k in keys if k in self._by_alias), None)


@dataclass(frozen=True, slots=True)
class SaveOutcome:
    created: int
    updated: int
    removed: int
    top: list[uuid.UUID]


def load_index(session: Session) -> tuple[list[ReadingCandidate], RowIndex]:
    rows = list(session.exec(select(ReadingCandidate).order_by(col(ReadingCandidate.created_at))))
    return rows, RowIndex(rows)


def save(session: Session, rebuild: Rebuild, *, limit: int = STORE_LIMIT) -> SaveOutcome:
    """Upsert the best `limit` candidates of a rebuild; commits."""
    rows, index = load_index(session)
    seen: set[uuid.UUID] = set()
    created = updated = 0
    for scored in rebuild.scored[:limit]:
        entry = rebuild.entries[scored.key]
        row = index.find(
            title=entry.title, openalex_id=entry.openalex_id, doi=entry.doi, arxiv_id=entry.arxiv_id
        )
        if row is None:
            row = ReadingCandidate(title=entry.title)
            created += 1
        elif row.id not in seen:
            updated += 1
        _write(row, entry, scored)
        session.add(row)
        index.add(row)
        seen.add(row.id)
    removed = 0
    for row in rows:
        if row.id not in seen and row.status == CandidateStatus.SUGGESTED and not _watched(row):
            session.delete(row)
            removed += 1
    session.commit()
    return SaveOutcome(created=created, updated=updated, removed=removed, top=top_ids(session))


def top_ids(session: Session, n: int = RECOMMEND_TOP_N) -> list[uuid.UUID]:
    """The best-scored suggested or queued candidates."""
    return list(
        session.exec(
            select(ReadingCandidate.id)
            .where(col(ReadingCandidate.status).in_(_LIVE))
            .order_by(col(ReadingCandidate.score).desc(), col(ReadingCandidate.id))
            .limit(n)
        )
    )


def merge_watch(
    session: Session,
    index: RowIndex,
    work: Work,
    document_id: uuid.UUID,
    *,
    ratings: dict[uuid.UUID, int],
    current_year: int,
) -> bool:
    """Record that the watch list found `work` (citing `document_id`); True when it is new.

    A new row gets a provisional score from what is known here; the `paper_candidates`
    rebuild the watch job queues next scores it with everything else.
    """
    source = {"kind": CandidateSource.WATCH.value, "document_id": str(document_id)}
    row = index.find(
        title=work.title, openalex_id=work.openalex_id, doi=work.doi, arxiv_id=work.arxiv_id
    )
    if row is not None:
        if source not in row.sources:
            row.sources = [*row.sources, source]
            session.add(row)
        return False
    row = ReadingCandidate(title=work.title, sources=[source])
    _write_work(row, work)
    facts = CandidateFacts(
        key=work.openalex_id,
        sources=(Source(CandidateSource.WATCH, document_id),),
        cited_by_count=work.cited_by_count,
        year=work.year,
    )
    provisional = score(facts, ratings=ratings, current_year=current_year)
    row.score, row.score_parts = provisional.score, provisional.parts
    session.add(row)
    index.add(row)
    return True


def queue_recommend_next(session: Session, candidate_ids: list[uuid.UUID]) -> Job | None:
    """Hook: queue `recommend_next` with `payload.candidate_ids` (the top N, best first),
    once a handler for that kind is registered. Commits when it enqueues."""
    if not candidate_ids or get_handler(JobKind.RECOMMEND_NEXT) is None:
        return None
    ids = [str(i) for i in candidate_ids]
    digest = hashlib.sha256(",".join(ids).encode()).hexdigest()[:32]
    return queue.enqueue(
        session,
        JobSpec(kind=JobKind.RECOMMEND_NEXT, input_hash=digest, payload={"candidate_ids": ids}),
    )


def _row_aliases(row: ReadingCandidate) -> list[str]:
    return aliases(openalex_id=row.openalex_id, doi=row.doi, arxiv_id=row.arxiv_id, title=row.title)


def _watched(row: ReadingCandidate) -> bool:
    return any(s.get("kind") == CandidateSource.WATCH for s in row.sources)


def _write(row: ReadingCandidate, entry: Entry, scored: Scored) -> None:
    if not entry.title_from_raw or not row.title:
        row.title = entry.title
    row.openalex_id = entry.openalex_id or row.openalex_id
    row.doi = entry.doi or row.doi
    row.arxiv_id = entry.arxiv_id or row.arxiv_id
    row.authors = entry.authors or row.authors
    row.year = entry.year or row.year
    row.venue = entry.venue or row.venue
    row.abstract = entry.abstract or row.abstract
    row.pdf_url = entry.pdf_url or row.pdf_url
    row.cited_by_count = (
        entry.cited_by_count if entry.cited_by_count is not None else row.cited_by_count
    )
    row.sources = _sources(entry)
    row.score, row.score_parts = scored.score, scored.parts


def _write_work(row: ReadingCandidate, work: Work) -> None:
    row.openalex_id, row.doi, row.arxiv_id = work.openalex_id, work.doi, work.arxiv_id
    row.authors, row.year, row.venue = list(work.authors), work.year, work.venue
    row.abstract, row.pdf_url, row.cited_by_count = work.abstract, work.pdf_url, work.cited_by_count


def _sources(entry: Entry) -> list[dict[str, Any]]:
    return [
        {"kind": str(kind), "document_id": str(doc) if doc else None}
        for kind, doc in sorted(entry.sources, key=lambda s: (str(s[0]), str(s[1])))
    ]

"""Where make-pills could run (docs/PILLS.md §5): the chapters `app.pills.generate` queues.

A chapter is *open* when it has a chapter distillation (the skill's only source) and no
`pill_set` yet. `candidates` ranks the open chapters of a feed's documents the way a top-up
takes them: the chapters in progress, then each document's next unread one, then the rest
in reading order; documents read most recently first within each rank. A chapter with a
make-pills job waiting, running, or queued today is left out, so a failing chapter costs
one try a day. The documents come resolved (`feed.scope.resolve`).

Every function takes a list of documents and runs a fixed handful of queries.
"""

import uuid
from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, time

from sqlalchemy import or_, tuple_
from sqlmodel import Session, col, select

from app.models import Artifact, Job, Node, ReadingPosition
from app.models.enums import ArtifactType, JobKind, JobState, Review
from app.pills.harvest.pill_set import SKILL
from app.reader_stats.facts import FINISHED

_LIVE = (JobState.QUEUED, JobState.RUNNING)


def today() -> datetime:
    """Midnight UTC: where a day's make-pills budget starts."""
    return datetime.combine(datetime.now(UTC).date(), time.min, tzinfo=UTC)


# --- Candidates ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Candidate:
    """A chapter make-pills could run on, with what orders it (lower first)."""

    document_id: uuid.UUID
    anchor: str
    rank: int  # 0 in progress, 1 next unread, 2 the rest
    recency: float  # minus the document's last reading timestamp (read most recently first)
    ordinal: int  # reading order within the document

    @property
    def key(self) -> tuple[int, float, int]:
        return (self.rank, self.recency, self.ordinal)


def anchors_with(
    session: Session, document_ids: Sequence[uuid.UUID], kind: ArtifactType
) -> dict[uuid.UUID, set[str]]:
    """Per document, the anchors with a non-rejected artifact of `kind`."""
    rows = session.exec(
        select(Artifact.document_id, Artifact.anchor).where(
            col(Artifact.document_id).in_(list(document_ids)),
            Artifact.type == kind,
            Artifact.review != Review.REJECTED,
            col(Artifact.anchor).is_not(None),
        )
    ).all()
    out: dict[uuid.UUID, set[str]] = defaultdict(set)
    for doc, anchor in rows:
        if anchor is not None:
            out[doc].add(anchor)
    return out


def _tried(session: Session, document_ids: Sequence[uuid.UUID]) -> set[tuple[uuid.UUID, str]]:
    """Chapters with a make-pills job waiting or running, or queued today."""
    rows = session.exec(
        select(Job.document_id, Job.anchor).where(
            Job.kind == JobKind.DERIVE,
            Job.skill == SKILL,
            col(Job.document_id).in_(list(document_ids)),
            or_(col(Job.state).in_(_LIVE), col(Job.created_at) >= today()),
        )
    ).all()
    return {(doc, anchor) for doc, anchor in rows if doc is not None and anchor is not None}


def _ordinals(
    session: Session, pairs: Iterable[tuple[uuid.UUID, str]]
) -> dict[tuple[uuid.UUID, str], int]:
    """Reading order of each `(document, anchor)` (anchors without a node are left out)."""
    wanted = list(pairs)
    if not wanted:
        return {}
    rows = session.exec(
        select(Node.document_id, Node.anchor, Node.ordinal).where(
            tuple_(col(Node.document_id), col(Node.anchor)).in_(wanted)
        )
    ).all()
    return {(doc, anchor): ordinal for doc, anchor, ordinal in rows}


def open_chapters(
    session: Session, document_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, list[tuple[str, int]]]:
    """Per document, its chapters with a chapter distillation and no `pill_set`, as
    `(anchor, ordinal)` in reading order. Documents with none are left out."""
    distilled = anchors_with(session, document_ids, ArtifactType.CHAPTER_DISTILLATION)
    composed = anchors_with(session, document_ids, ArtifactType.PILL_SET)
    pairs = [(doc, a) for doc, anchors in distilled.items() for a in anchors - composed[doc]]
    out: dict[uuid.UUID, list[tuple[str, int]]] = defaultdict(list)
    for (doc, anchor), ordinal in sorted(_ordinals(session, pairs).items(), key=lambda r: r[1]):
        out[doc].append((anchor, ordinal))
    return dict(out)


def generatable(session: Session, document_id: uuid.UUID) -> list[str]:
    """One document's chapters make-pills could run on, in reading order."""
    return [anchor for anchor, _ in open_chapters(session, [document_id]).get(document_id, [])]


def _ranked(
    document_id: uuid.UUID,
    chapters: Sequence[tuple[str, int]],
    positions: Sequence[ReadingPosition],
    read_ordinals: Mapping[str, int],
) -> list[Candidate]:
    """One document's chapters ranked: in progress, the next unread, the rest."""
    read = {p.unit: p for p in positions}
    last = max((p.updated_at.timestamp() for p in positions), default=0.0)
    furthest = max(read_ordinals.values(), default=None)
    next_unread = next(
        (a for a, o in chapters if a not in read and (furthest is None or o > furthest)), None
    )
    out = []
    for anchor, ordinal in chapters:
        position = read.get(anchor)
        if position is not None and 0 < position.progress < FINISHED:
            rank = 0
        elif anchor == next_unread:
            rank = 1
        else:
            rank = 2
        out.append(Candidate(document_id, anchor, rank, -last, ordinal))
    return out


def candidates(session: Session, document_ids: Sequence[uuid.UUID]) -> list[Candidate]:
    """The open chapters of these documents not tried today, best first (`Candidate.key`).
    A handful of queries whatever the number of documents."""
    tried = _tried(session, document_ids)
    chapters = {
        doc: [(a, o) for a, o in found if (doc, a) not in tried]
        for doc, found in open_chapters(session, document_ids).items()
    }
    chapters = {doc: found for doc, found in chapters.items() if found}
    if not chapters:
        return []
    positions: dict[uuid.UUID, list[ReadingPosition]] = defaultdict(list)
    for position in session.exec(
        select(ReadingPosition).where(col(ReadingPosition.document_id).in_(list(chapters)))
    ).all():
        positions[position.document_id].append(position)
    read = _ordinals(session, [(doc, p.unit) for doc, ps in positions.items() for p in ps])
    found = [
        candidate
        for doc, open_ in chapters.items()
        for candidate in _ranked(
            doc,
            open_,
            positions[doc],
            {a: o for (d, a), o in read.items() if d == doc},
        )
    ]
    return sorted(found, key=lambda c: c.key)

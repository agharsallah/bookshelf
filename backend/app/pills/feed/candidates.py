"""The candidates of a feed: its scope's pills and due review items, as `rank.Candidate`s.

Buckets (`mixer.TARGETS`): connection pills count as connections; in *explore*, pills of a
document you have not started are serendipity; due review items (consolidate, explore and
review modes, when the kinds allow `review`) are reviews; the rest is main.

`scope_match` rises with a unit read in the last week (consolidate), each concept matched
beyond the first, and, for a review, how overdue it is (up to a month).
"""

import uuid
from collections.abc import Collection, Sequence
from datetime import datetime

from sqlmodel import Session, col, select

from app.models import ReviewItem
from app.models.enums import PillKind
from app.models.pill import Pill
from app.pills.contract import is_active
from app.pills.feed import history
from app.pills.feed.config import FeedMode
from app.pills.feed.rank import Bucket, Candidate
from app.pills.feed.scope import Scope, pill_conditions

FRESH_BONUS = 0.5
CONCEPT_BONUS = 0.25
OVERDUE_DAYS = 30
REVIEW_MODES = frozenset({FeedMode.CONSOLIDATE, FeedMode.EXPLORE, FeedMode.REVIEW})


def unit_of(anchor: str) -> str:
    """The unit a passage anchor sits in (`ch03/s01/p004` → `ch03`)."""
    return anchor.split("/", 1)[0]


def _edge_key(row: Pill) -> frozenset[tuple[str, str]] | None:
    """A connection's two passages, whichever side the pill tells it from."""
    if row.kind is not PillKind.CONNECTION:
        return None
    return frozenset((s["document"]["id"], s["anchor"]) for s in row.body["sides"])


def one_per_edge(rows: Sequence[Pill]) -> list[Pill]:
    """Each document holds its own view of a cross-document connection (its side first);
    a scope covering both documents keeps one of the two (the first, by id)."""
    kept: set[frozenset[tuple[str, str]]] = set()
    out = []
    for row in sorted(rows, key=lambda r: r.id):
        key = _edge_key(row)
        if key is not None:
            if key in kept:
                continue
            kept.add(key)
        out.append(row)
    return out


def scope_pills(session: Session, scope: Scope) -> list[Pill]:
    """Live pills of the scope, in the units its mode allows (one per connection)."""
    if scope.mode is FeedMode.REVIEW or not scope.documents:
        return []
    allowed = {doc_id: scope.allowed(doc_id) for doc_id in scope.documents}
    rows = session.exec(select(Pill).where(*pill_conditions(scope))).all()
    rows = one_per_edge([r for r in rows if r.anchor in allowed[r.document_id]])
    if scope.mode is FeedMode.PREVIEW:
        rows = [r for r in rows if is_active(r.kind, r.body)]
    return rows


def due_reviews(
    session: Session, scope: Scope, now: datetime, *, exclude: Collection[uuid.UUID] = ()
) -> list[ReviewItem]:
    if scope.mode not in REVIEW_MODES or not scope.config.allows(PillKind.REVIEW):
        return []
    if not scope.documents:
        return []
    query = select(ReviewItem).where(
        col(ReviewItem.document_id).in_(list(scope.documents)), col(ReviewItem.due) <= now
    )
    if exclude:
        query = query.where(col(ReviewItem.id).not_in(list(exclude)))
    return list(session.exec(query.order_by(col(ReviewItem.due))).all())


def _bucket(scope: Scope, row: Pill) -> Bucket:
    if row.kind is PillKind.CONNECTION:
        return Bucket.CONNECTION
    state = scope.reading.get(row.document_id)
    if scope.mode is FeedMode.EXPLORE and (state is None or not state.started):
        return Bucket.SERENDIPITY
    return Bucket.MAIN


def _scope_match(scope: Scope, row: Pill, now: datetime) -> float:
    match = 1.0
    if scope.mode is FeedMode.CONSOLIDATE and scope.fresh(row.document_id, row.anchor, now):
        match += FRESH_BONUS
    if scope.concepts:
        hits = sum(1 for c in row.concepts if c.lower() in scope.concepts)
        match += CONCEPT_BONUS * max(hits - 1, 0)
    return match


def load(
    session: Session, scope: Scope, now: datetime, *, exclude: Collection[uuid.UUID] = ()
) -> list[Candidate]:
    """Every candidate of the scope not in `exclude` (what the session already served)."""
    skip = set(exclude)
    rows = [r for r in scope_pills(session, scope) if r.id not in skip]
    reviews = due_reviews(session, scope, now, exclude=skip)
    seen, confusing = history.per_pill(session, [r.id for r in rows])
    recent = history.unit_recent(session, {r.document_id for r in rows}, now=now)
    out = [
        Candidate(
            id=r.id,
            kind=r.kind,
            document_id=r.document_id,
            anchor=r.anchor,
            active=is_active(r.kind, r.body),
            bucket=_bucket(scope, r),
            thread_key=r.thread_key,
            thread_index=r.thread_index,
            draft=r.draft,
            scope_match=_scope_match(scope, r, now),
            seen=seen[r.id],
            confusing=confusing[r.id],
            unit_recent=recent[(r.document_id, r.anchor)],
        )
        for r in rows
    ]
    for item in reviews:
        overdue = max((now - item.due).total_seconds() / 86_400, 0.0)
        out.append(
            Candidate(
                id=item.id,
                kind=PillKind.REVIEW,
                document_id=item.document_id,
                anchor=unit_of(item.anchor),
                active=True,
                bucket=Bucket.REVIEW,
                scope_match=1.0 + min(overdue, OVERDUE_DAYS) / OVERDUE_DAYS,
            )
        )
    return out


def served(session: Session, scope: Scope, ids: list[uuid.UUID]) -> list[Candidate]:
    """What a session already served, as candidates (for the mixer's history), in order."""
    if not ids:
        return []
    rows = {p.id: p for p in session.exec(select(Pill).where(col(Pill.id).in_(ids))).all()}
    rest = [i for i in ids if i not in rows]
    items = (
        {i.id: i for i in session.exec(select(ReviewItem).where(col(ReviewItem.id).in_(rest)))}
        if rest
        else {}
    )
    out: list[Candidate] = []
    for served_id in ids:
        if (row := rows.get(served_id)) is not None:
            out.append(
                Candidate(
                    id=row.id,
                    kind=row.kind,
                    document_id=row.document_id,
                    anchor=row.anchor,
                    active=is_active(row.kind, row.body),
                    bucket=_bucket(scope, row),
                    thread_key=row.thread_key,
                    thread_index=row.thread_index,
                )
            )
        elif (item := items.get(served_id)) is not None:
            out.append(
                Candidate(
                    id=item.id,
                    kind=PillKind.REVIEW,
                    document_id=item.document_id,
                    anchor=unit_of(item.anchor),
                    active=True,
                    bucket=Bucket.REVIEW,
                )
            )
    return out

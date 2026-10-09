"""What past `pill_events` say about candidates (inputs to `rank`), in a few grouped queries.

* `per_pill`: how often each pill was seen and marked confusing (all time);
* `unit_recent`: pills seen per unit in the last day (the spacing term);
* `kind_signals`: per kind, the last 30 days of seen, long dwell, save, skip, too_easy and
  confusing (the kind affinity term). A dwell counts when it lasted `LONG_DWELL_MS`.
"""

import uuid
from collections import Counter, defaultdict
from collections.abc import Collection
from datetime import datetime, timedelta

from sqlalchemy import Integer, cast, func
from sqlmodel import Session, col, select

from app.models._columns import utcnow
from app.models.enums import PillEventKind, PillKind
from app.models.pill import Pill, PillEvent
from app.pills.feed.rank import KindSignals

AFFINITY_WINDOW = timedelta(days=30)
SPACING_WINDOW = timedelta(days=1)
LONG_DWELL_MS = 12_000

_SIGNAL_FIELDS = {
    PillEventKind.SEEN: "seen",
    PillEventKind.SAVE: "saves",
    PillEventKind.SKIP: "skips",
    PillEventKind.TOO_EASY: "too_easy",
    PillEventKind.CONFUSING: "confusing",
}


def per_pill(
    session: Session, pill_ids: Collection[uuid.UUID]
) -> tuple[Counter[uuid.UUID], Counter[uuid.UUID]]:
    """`(seen, confusing)` counts per pill (or review item) id."""
    seen: Counter[uuid.UUID] = Counter()
    confusing: Counter[uuid.UUID] = Counter()
    if not pill_ids:
        return seen, confusing
    target = func.coalesce(col(PillEvent.pill_id), col(PillEvent.review_item_id))
    rows = session.exec(
        select(target, PillEvent.kind, func.count())
        .where(
            col(PillEvent.kind).in_([PillEventKind.SEEN, PillEventKind.CONFUSING]),
            target.in_(list(pill_ids)),
        )
        .group_by(target, col(PillEvent.kind))
    ).all()
    for pill_id, kind, n in rows:
        (seen if kind is PillEventKind.SEEN else confusing)[pill_id] = int(n)
    return seen, confusing


def unit_recent(
    session: Session, document_ids: Collection[uuid.UUID], *, now: datetime | None = None
) -> Counter[tuple[uuid.UUID, str]]:
    """Pills seen per `(document, unit)` since a day ago."""
    since = (now or utcnow()) - SPACING_WINDOW
    rows = session.exec(
        select(Pill.document_id, Pill.anchor, func.count())
        .join(PillEvent, col(PillEvent.pill_id) == col(Pill.id))
        .where(
            PillEvent.kind == PillEventKind.SEEN,
            col(PillEvent.at) >= since,
            col(Pill.document_id).in_(list(document_ids)),
        )
        .group_by(col(Pill.document_id), col(Pill.anchor))
    ).all()
    return Counter({(d, a): int(n) for d, a, n in rows})


def kind_signals(session: Session, *, now: datetime | None = None) -> dict[PillKind, KindSignals]:
    """Per kind, the counts the affinity is computed from (review pills: kind `review`)."""
    since = (now or utcnow()) - AFFINITY_WINDOW
    kind = func.coalesce(col(Pill.kind), PillKind.REVIEW)  # an event on a review pill
    dwell_ms = cast(col(PillEvent.value)["ms"].astext, Integer)
    counts: dict[PillKind, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    rows = session.exec(
        select(kind, PillEvent.kind, func.count())
        .select_from(PillEvent)
        .outerjoin(Pill, col(Pill.id) == col(PillEvent.pill_id))
        .where(col(PillEvent.at) >= since, col(PillEvent.kind).in_(list(_SIGNAL_FIELDS)))
        .group_by(kind, col(PillEvent.kind))
    ).all()
    for pill_kind, event_kind, n in rows:
        counts[PillKind(pill_kind)][_SIGNAL_FIELDS[PillEventKind(event_kind)]] += int(n)
    dwells = session.exec(
        select(kind, func.count())
        .select_from(PillEvent)
        .outerjoin(Pill, col(Pill.id) == col(PillEvent.pill_id))
        .where(
            col(PillEvent.at) >= since,
            PillEvent.kind == PillEventKind.DWELL,
            dwell_ms >= LONG_DWELL_MS,
        )
        .group_by(kind)
    ).all()
    for pill_kind, n in dwells:
        counts[PillKind(pill_kind)]["long_dwells"] += int(n)
    return {k: KindSignals(**fields) for k, fields in counts.items()}

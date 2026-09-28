"""Attention, minute by minute: what the browser's attention clock reports (`POST /activity`).

Each report is seconds counted on one surface, at one place, within one minute. Reports for
the same minute and place add up, and a row never holds more than the minute it covers.
Reports older than `MAX_AGE` or from the future are refused: the clock flushes within a
minute, so anything else is a bad clock, not a late report. A report naming a document that
no longer exists is dropped (a book deleted while its page was open), not an error.
"""

import uuid
from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, or_
from sqlalchemy.dialects.postgresql import insert
from sqlmodel import Session, col, select

from app.models import ActivityMinute, Document
from app.models.enums import Surface
from app.services.errors import InvalidInputError

MAX_AGE = timedelta(days=7)
CLOCK_SKEW = timedelta(minutes=5)
MINUTE_SECONDS = 60


@dataclass(frozen=True, slots=True)
class Report:
    at: datetime
    surface: Surface
    seconds: int
    document: str | None = None  # uuid or slug
    unit: str = ""
    anchor: str = ""
    detail: str = ""


Key = tuple[datetime, Surface, uuid.UUID | None, str, str, str]


def _minute(at: datetime) -> datetime:
    return at.astimezone(UTC).replace(second=0, microsecond=0)


def _check_time(reports: Sequence[Report], now: datetime) -> None:
    for i, report in enumerate(reports):
        if report.at.tzinfo is None:
            raise InvalidInputError("`at` needs a timezone.", field=f"body.entries.{i}.at")
        if not now - MAX_AGE <= report.at <= now + CLOCK_SKEW:
            raise InvalidInputError(
                "`at` must lie within the last 7 days.", field=f"body.entries.{i}.at"
            )


def _resolve(session: Session, refs: Iterable[str]) -> dict[str, uuid.UUID]:
    """Each ref (uuid or slug) to its document id; refs to no document are left out."""
    refs = set(refs)
    if not refs:
        return {}
    ids: set[uuid.UUID] = set()
    for ref in refs:
        try:
            ids.add(uuid.UUID(ref))
        except ValueError:
            continue
    rows = session.exec(
        select(Document.id, Document.slug).where(
            or_(col(Document.id).in_(ids), col(Document.slug).in_(refs))
        )
    ).all()
    out: dict[str, uuid.UUID] = {}
    for doc_id, slug in rows:
        out[slug] = doc_id
        out[str(doc_id)] = doc_id
    return out


def _merge(reports: Sequence[Report], ids: dict[str, uuid.UUID]) -> dict[Key, int]:
    """Sum reports per row: one statement may not upsert the same row twice."""
    merged: dict[Key, int] = defaultdict(int)
    for r in reports:
        doc_id = None
        if r.document is not None:
            doc_id = ids.get(r.document)
            if doc_id is None:
                continue
        key = (_minute(r.at), r.surface, doc_id, r.unit, r.anchor, r.detail)
        merged[key] = min(MINUTE_SECONDS, merged[key] + r.seconds)
    return merged


def record(session: Session, reports: Sequence[Report], *, now: datetime | None = None) -> int:
    """Add the reports to their minutes; returns how many rows they touched."""
    _check_time(reports, now or datetime.now(UTC))
    merged = _merge(reports, _resolve(session, (r.document for r in reports if r.document)))
    if not merged:
        return 0
    table = ActivityMinute.__table__  # type: ignore[attr-defined]
    stmt = insert(table).values(
        [
            {"minute": m, "surface": s.value, "document_id": d, "unit": u, "anchor": a,
             "detail": x, "seconds": seconds}
            for (m, s, d, u, a, x), seconds in merged.items()
        ]
    )  # fmt: skip
    stmt = stmt.on_conflict_do_update(
        constraint="activity_minutes_key",
        set_={"seconds": func.least(MINUTE_SECONDS, table.c.seconds + stmt.excluded.seconds)},
    )
    session.execute(stmt)
    session.commit()
    return len(merged)

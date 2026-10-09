"""Served ids → wire pills. A session serves pill ids and, for review pills, review item ids.

A review pill is synthesized from its due `review_item` (never stored in `pills`): the
item's prompt and cited answer, its unit (the first segment of its anchor), origin
`review:<source>`, `review_item_id` set. An item whose answer does not fit the contract
(no spans) is left out, as is an id whose pill or item is gone.
"""

import logging
import uuid
from collections.abc import Sequence

from pydantic import ValidationError
from sqlalchemy import tuple_
from sqlmodel import Session, col, select

from app.models import Node, ReviewItem
from app.models.enums import PillKind
from app.models.pill import Pill
from app.pills.contract import PillOut, ReviewBody, dump_body
from app.pills.feed.candidates import unit_of
from app.pills.harvest.base import est_seconds
from app.pills.serialize import Lookups, document_out, load_lookups, sources_for, to_wire

logger = logging.getLogger(__name__)
SPAN_KEYS = frozenset({"text", "cites", "mark"})


def review_pill(item: ReviewItem, lookups: Lookups) -> PillOut | None:
    document = lookups.documents.get(item.document_id)
    if document is None:
        return None
    unit = unit_of(item.anchor)
    try:
        answer = [{k: v for k, v in span.items() if k in SPAN_KEYS} for span in item.answer]
        body = dump_body(ReviewBody.model_validate({"prompt": item.prompt, "answer": answer}))
        return PillOut(
            id=item.id,
            kind=PillKind.REVIEW,
            document=document_out(document, lookups.themes.get(item.document_id)),
            anchor=unit,
            unit_title=lookups.unit_titles.get((item.document_id, unit)),
            headline=None,
            body=body,
            cites=[item.anchor],
            sources=sources_for(document, [item.anchor], lookups),
            concepts=[],
            thread=None,
            est_seconds=est_seconds(PillKind.REVIEW, body),
            origin=f"review:{item.source.value}",
            draft=False,
            review_item_id=item.id,
        )
    except ValidationError:
        logger.warning("Review item does not fit a pill", extra={"item_id": str(item.id)})
        return None


def render(session: Session, ids: Sequence[uuid.UUID]) -> list[PillOut]:
    """The wire pills of `ids`, in order (gone ones left out)."""
    if not ids:
        return []
    rows = {p.id: p for p in session.exec(select(Pill).where(col(Pill.id).in_(list(ids)))).all()}
    rest = [i for i in ids if i not in rows]
    items = {
        i.id: i
        for i in (
            session.exec(select(ReviewItem).where(col(ReviewItem.id).in_(rest))).all()
            if rest
            else []
        )
    }
    lookups = load_lookups(
        session, list(rows.values()), extra_documents={i.document_id for i in items.values()}
    )
    units = {(i.document_id, unit_of(i.anchor)) for i in items.values()}
    if units:
        nodes = session.exec(
            select(Node.document_id, Node.anchor, Node.heading).where(
                tuple_(col(Node.document_id), col(Node.anchor)).in_(list(units))
            )
        ).all()
        lookups.unit_titles.update({(d, a): h for d, a, h in nodes})
    out: list[PillOut] = []
    for pill_id in ids:
        if (row := rows.get(pill_id)) is not None:
            out.append(to_wire(row, lookups))
        elif (item := items.get(pill_id)) is not None and (pill := review_pill(item, lookups)):
            out.append(pill)
    return out

"""Load the facts reader statistics are computed from: one query per table.

This is the only module that queries. A single user's history is small (a minute row per
minute of attention), so everything in scope is loaded and the pure modules do the rest.
"""

import uuid
from collections import defaultdict
from collections.abc import Sequence
from datetime import datetime
from typing import Any

from sqlalchemy import text
from sqlmodel import Session

from app.models.enums import Surface
from app.reader_stats.facts import (
    BookFact,
    CardFact,
    ChapterFact,
    Facts,
    MentionFact,
    MinuteFact,
    NoteFact,
    PositionFact,
    RecallFact,
    ReviewFact,
)
from app.stats.collect import reading_order

_WORDS = "coalesce(array_length(regexp_split_to_array(btrim({col}), '\\s+'), 1), 0)"
_SCOPE = "(cast(:doc as uuid) is null or {col} = cast(:doc as uuid))"


def _scoped(sql: str, col: str = "document_id") -> Any:
    return text(sql.replace("{scope}", _SCOPE.format(col=col)))


_DOCUMENTS = _scoped(
    "select id, slug, title, authors, page_count, created_at from documents where {scope}",
    col="id",
)

_CONTAINERS = _scoped(
    "select id, document_id, parent_id, kind, ordinal from nodes "
    "where kind in ('part', 'chapter') and {scope}"
)

_CHAPTERS = _scoped(
    f"""
    select c.id, c.document_id, c.anchor, coalesce(c.heading, c.anchor), c.page_from, c.page_to,
           coalesce(c.meta->>'front_matter' = 'true', false),
           coalesce(sum({_WORDS.format(col="n.text")}) filter (where n.text is not null), 0)
    from nodes c
    left join nodes n on n.document_id = c.document_id and starts_with(n.anchor, c.anchor || '/')
    where c.kind = 'chapter' and {{scope}}
    group by c.id
    """,  # noqa: S608  (constant SQL fragment)
    col="c.document_id",
)

_MINUTES = _scoped(
    "select minute, surface, document_id, unit, anchor, detail, seconds from activity_minutes "
    "where minute >= :since and {scope}"
)

_POSITIONS = _scoped(
    "select document_id, unit, progress, updated_at from reading_positions where {scope}"
)

_NOTES = _scoped(
    f"""
    select document_id, anchor, color, target,
           case when raw is null then 0 else {_WORDS.format(col="raw")} end, created_at
    from notes where created_at >= :since and {{scope}}
    """  # noqa: S608  (constant SQL fragment)
)

_RECALLS = _scoped(
    f"""
    select r.document_id, r.unit, r.kind, {_WORDS.format(col="r.raw")}, r.created_at,
           case when g.recall_id is null then null
                else array(select i->>'status' from jsonb_array_elements(g.ideas) i) end
    from recalls r left join recall_grades g on g.recall_id = r.id
    where r.created_at >= :since and {{scope}}
    """,  # noqa: S608  (constant SQL fragment)
    col="r.document_id",
)

_REVIEWS = _scoped(
    """
    select i.document_id, i.anchor, i.source, l.rating, l.reviewed_at
    from review_logs l join review_items i on i.id = l.item_id
    where l.reviewed_at >= :since and {scope}
    """,
    col="i.document_id",
)

_CARDS = _scoped(
    """
    select document_id, source, due,
           case jsonb_typeof(card->'state') when 'number' then (card->>'state')::int end,
           case jsonb_typeof(card->'stability') when 'number'
                then (card->>'stability')::float8 end
    from review_items where {scope}
    """
)

_MENTIONS = _scoped(
    """
    select split_part(e.src_id, '#', 1)::uuid, split_part(e.src_id, '#', 2), c.id,
           c.canonical, c.kind
    from edges e join concepts c on c.id::text = e.dst_id
    where e.src_kind = 'node' and e.dst_kind = 'concept' and e.status = 'accepted'
      and e.relation in ('mentions', 'defines') and c.merged_into is null
      and e.src_id like '%#%' and {scope}
    """,
    col="split_part(e.src_id, '#', 1)::uuid",
)

_TEXTS = text(
    "select document_id, anchor, left(regexp_replace(text, '\\s+', ' ', 'g'), :chars) "
    "from nodes where text is not null and (document_id, anchor) in "
    "(select * from unnest(cast(:ids as uuid[]), cast(:anchors as text[])))"
)


def _chapters(session: Session, params: dict[str, Any]) -> dict[uuid.UUID, list[ChapterFact]]:
    order = reading_order(list(session.execute(_CONTAINERS, params).all()))
    rows = sorted(session.execute(_CHAPTERS, params).all(), key=lambda r: order.get(r[0], ()))
    out: dict[uuid.UUID, list[ChapterFact]] = defaultdict(list)
    for r in rows:
        chapters = out[r[1]]
        chapters.append(
            ChapterFact(
                anchor=r[2],
                title=r[3],
                position=len(chapters),
                page_from=r[4],
                page_to=r[5],
                front_matter=bool(r[6]),
                words=int(r[7]),
            )
        )
    return out


def load(session: Session, *, since: datetime, document_id: uuid.UUID | None = None) -> Facts:
    """Everything dated on or after `since` (progress and cards: as of now), for one book or all."""
    params: dict[str, Any] = {"since": since, "doc": str(document_id) if document_id else None}

    def rows(query: Any) -> list[Any]:
        return list(session.execute(query, params).all())

    chapters = _chapters(session, params)
    books = tuple(
        BookFact(
            id=r[0],
            slug=r[1],
            title=r[2],
            authors=tuple(r[3] or ()),
            pages=r[4],
            created_at=r[5],
            chapters=tuple(chapters.get(r[0], ())),
        )
        for r in sorted(rows(_DOCUMENTS), key=lambda r: r[2].lower())
    )
    return Facts(
        books=books,
        minutes=tuple(
            MinuteFact(r[0], Surface(r[1]), r[2], r[3], r[4], r[5], int(r[6]))
            for r in rows(_MINUTES)
        ),
        positions=tuple(PositionFact(r[0], r[1], float(r[2]), r[3]) for r in rows(_POSITIONS)),
        notes=tuple(NoteFact(r[0], r[1], r[2], r[3], int(r[4]), r[5]) for r in rows(_NOTES)),
        recalls=tuple(
            RecallFact(r[0], r[1], r[2], int(r[3]), r[4], tuple(r[5]) if r[5] is not None else None)
            for r in rows(_RECALLS)
        ),
        reviews=tuple(ReviewFact(r[0], r[1], r[2], int(r[3]), r[4]) for r in rows(_REVIEWS)),
        cards=tuple(CardFact(*r) for r in rows(_CARDS)),
        mentions=tuple(MentionFact(*r) for r in rows(_MENTIONS)),
    )


def texts(
    session: Session, blocks: Sequence[tuple[uuid.UUID, str]], chars: int = 220
) -> dict[tuple[uuid.UUID, str], str]:
    """The opening `chars` characters of each block, whitespace collapsed."""
    if not blocks:
        return {}
    params = {"ids": [b[0] for b in blocks], "anchors": [b[1] for b in blocks], "chars": chars}
    return {(r[0], r[1]): r[2] for r in session.execute(_TEXTS, params).all()}


_TRACKED_SINCE = _scoped("select min(minute) from activity_minutes where {scope}")


def tracked_since(session: Session, document_id: uuid.UUID | None = None) -> datetime | None:
    """The first tracked minute, whatever the window."""
    params = {"doc": str(document_id) if document_id else None}
    value: datetime | None = session.execute(_TRACKED_SINCE, params).scalar()
    return value

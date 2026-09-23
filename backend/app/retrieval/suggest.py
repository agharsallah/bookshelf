"""Typeahead for the search box: document titles, chapter headings, concept names.

Three small indexed-or-tiny queries against Postgres, no vectors, so it stays fast enough
to run on every keystroke. Prefix matches rank before substring matches.
"""

from itertools import chain, zip_longest
from typing import Any

from sqlalchemy import ColumnElement, case, func, or_
from sqlmodel import Session, col, select

from app.models import Concept, Document, Node
from app.models.enums import NodeKind
from app.retrieval.refs import document_ref
from app.schemas.search import SuggestItem
from app.services.sql import contains_pattern, escape_like


def _prefix_first(column: Any, q: str) -> ColumnElement[int]:
    return case((func.lower(column).like(f"{escape_like(q.lower())}%", escape="\\"), 0), else_=1)


def suggest(session: Session, q: str, *, limit: int = 10) -> list[SuggestItem]:
    pattern = contains_pattern(q)
    documents = session.exec(
        select(Document)
        .where(or_(col(Document.title).ilike(pattern), col(Document.slug).ilike(pattern)))
        .order_by(_prefix_first(Document.title, q), col(Document.title))
        .limit(limit)
    ).all()
    chapters = session.exec(
        select(Node, Document)
        .join(Document, col(Document.id) == col(Node.document_id))
        .where(
            col(Node.kind).in_([NodeKind.PART, NodeKind.CHAPTER]),
            col(Node.heading).ilike(pattern),
        )
        .order_by(_prefix_first(Node.heading, q), col(Node.heading))
        .limit(limit)
    ).all()
    alias = func.array_to_string(col(Concept.aliases), " ")
    concepts = session.exec(
        select(Concept)
        .where(
            col(Concept.merged_into).is_(None),
            or_(col(Concept.canonical).ilike(pattern), alias.ilike(pattern)),
        )
        .order_by(_prefix_first(Concept.canonical, q), col(Concept.canonical))
        .limit(limit)
    ).all()
    docs = [
        SuggestItem(kind="document", label=d.title, document=document_ref(d)) for d in documents
    ]
    heads = [
        SuggestItem(
            kind="chapter", label=n.heading or n.anchor, document=document_ref(d), anchor=n.anchor
        )
        for n, d in chapters
    ]
    names = [SuggestItem(kind="concept", label=c.canonical) for c in concepts]
    # Round-robin, so one kind with many matches cannot crowd out the others.
    merged = [i for i in chain.from_iterable(zip_longest(docs, heads, names)) if i is not None]
    return merged[:limit]

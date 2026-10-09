"""What a feed draws from (docs/PILLS.md §6): sources → documents → the units each mode allows.

* **Documents**: `documents` + members of `collections` + `paper_sets` + documents with pills
  on one of `concepts` (all empty: the whole shelf), narrowed by `genre`; archived ones never.
* **Concepts**: when given, a pill qualifies when its document was named outright or its
  `concepts` overlap them (names compared case-insensitively, a concept's aliases included).
* **Units by mode** (`allowed_units`, pure): *consolidate* the units you have read (before
  your latest reading position, finished ones, or all of a finished document), falling back
  to *explore* with `notice = "nothing read yet"` when nothing in scope is read; *preview*
  the next `PREVIEW_UNITS` unread units; *explore* everything, except, without `spoilers`,
  the units past the one you are reading in a document you have started; *review* no pills.
"""

import uuid
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from sqlalchemy import ARRAY, ColumnElement, Text, bindparam, func, or_, text, tuple_
from sqlmodel import Session, col, select

from app.core.errors import NotFoundError
from app.models import Concept, Document, Node, PaperSet, ReadingPosition
from app.models.document import not_archived
from app.models.enums import NodeKind
from app.models.pill import Pill
from app.pills.feed.config import FeedConfig, FeedMode
from app.reader_stats.facts import FINISHED
from app.services import collections
from app.services.documents import get_document

NOTHING_READ = "nothing read yet"
PREVIEW_UNITS = 2
FRESH = timedelta(days=7)  # a unit read this recently weighs more when consolidating


@dataclass(slots=True)
class ReadState:
    """Your reading of one document: finished, per-unit progress, the latest unit."""

    finished: bool = False
    progress: dict[str, float] = field(default_factory=dict)
    read_at: dict[str, datetime] = field(default_factory=dict)
    current: str | None = None  # the most recently read unit

    @property
    def started(self) -> bool:
        return self.finished or bool(self.progress)


def read_units(order: Sequence[str], state: ReadState) -> set[str]:
    """Units read: all of a finished document, finished units, and those before the latest."""
    if state.finished:
        return set(order)
    done = {unit for unit, p in state.progress.items() if p >= FINISHED}
    if state.current in order:
        done |= set(order[: order.index(state.current)])
    return done & set(order)


def allowed_units(
    mode: FeedMode, order: Sequence[str], state: ReadState, *, spoilers: bool
) -> set[str]:
    """The units of one document (in reading `order`) a mode serves pills from."""
    read = read_units(order, state)
    if mode is FeedMode.CONSOLIDATE:
        return read
    if mode is FeedMode.PREVIEW:
        return set([u for u in order if u not in read][:PREVIEW_UNITS])
    if mode is FeedMode.EXPLORE:
        if spoilers or not state.started:
            return set(order)
        return read | ({state.current} & set(order) if state.current else set())
    return set()


@dataclass(slots=True)
class Scope:
    config: FeedConfig
    mode: FeedMode  # the effective mode (consolidate may fall back to explore)
    notice: str | None
    documents: dict[uuid.UUID, Document]
    named: set[uuid.UUID] | None  # documents the sources name outright; None: no such source
    concepts: frozenset[str]  # lower-cased concept names (and aliases)
    reading: dict[uuid.UUID, ReadState]
    units: dict[uuid.UUID, list[str]]  # units per document, in reading order
    titles: dict[tuple[uuid.UUID, str], str | None]

    def allowed(self, document_id: uuid.UUID) -> set[str]:
        order = self.units.get(document_id, [])
        state = self.reading.get(document_id, ReadState())
        return allowed_units(self.mode, order, state, spoilers=self.config.spoilers)

    def fresh(self, document_id: uuid.UUID, unit: str, now: datetime) -> bool:
        state = self.reading.get(document_id)
        at = state.read_at.get(unit) if state else None
        return at is not None and now - at <= FRESH


# --- Sources → documents -----------------------------------------------------------------


def _paper_set(session: Session, ref: str) -> PaperSet:
    found: PaperSet | None
    try:
        found = session.get(PaperSet, uuid.UUID(ref))
    except ValueError:
        found = session.exec(select(PaperSet).where(PaperSet.name == ref)).first()
    if found is None:
        raise NotFoundError(f"Paper set {ref} does not exist.")
    return found


def _named_documents(session: Session, config: FeedConfig) -> set[uuid.UUID] | None:
    sources = config.sources
    if not (sources.documents or sources.collections or sources.paper_sets):
        return None
    ids = {get_document(session, ref).id for ref in sources.documents}
    for ref in sources.collections:
        ids |= set(collections.document_ids(session, collections.get_collection(session, ref).id))
    for ref in sources.paper_sets:
        ids |= set(_paper_set(session, ref).document_ids)
    return ids


def concept_names(session: Session, refs: Sequence[str]) -> frozenset[str]:
    """Lower-cased names for concept ids or names, each with its concept's aliases."""
    names: set[str] = set()
    for ref in refs:
        try:
            concept = session.get(Concept, uuid.UUID(ref))
        except ValueError:
            names.add(ref.strip().lower())
            continue
        if concept is None:
            raise NotFoundError(f"Concept {ref} does not exist.")
        names.add(concept.canonical.lower())
    if names:
        aliased = text(
            "exists (select 1 from unnest(concepts.aliases) as a where lower(a) = any(:names))"
        ).bindparams(bindparam("names", sorted(names), type_=ARRAY(Text)))
        for concept in session.exec(
            select(Concept).where(or_(func.lower(Concept.canonical).in_(sorted(names)), aliased))
        ).all():
            names |= {concept.canonical.lower(), *(a.lower() for a in concept.aliases)}
    return frozenset(names)


def concept_overlap(names: frozenset[str]) -> ColumnElement[bool]:
    """`where` clause: the pill names one of `names` (case-insensitive)."""
    return text(
        "exists (select 1 from unnest(pills.concepts) as c where lower(c) = any(:names))"
    ).bindparams(bindparam("names", sorted(names), type_=ARRAY(Text)))  # type: ignore[return-value]


def pill_conditions(scope: Scope) -> list[ColumnElement[bool]]:
    """`where` clauses for the live pills of a scope (units by mode are applied in Python)."""
    conditions: list[ColumnElement[bool]] = [
        col(Pill.retired_at).is_(None),
        col(Pill.document_id).in_(list(scope.documents)),
    ]
    if scope.config.kinds is not None:
        conditions.append(col(Pill.kind).in_(scope.config.kinds))
    if scope.concepts:
        overlap = concept_overlap(scope.concepts)
        named = list(scope.named or ())
        conditions.append(or_(col(Pill.document_id).in_(named), overlap) if named else overlap)
    return conditions


def _documents(
    session: Session, config: FeedConfig, named: set[uuid.UUID] | None, names: frozenset[str]
) -> dict[uuid.UUID, Document]:
    query = select(Document).where(not_archived())
    if config.sources.genre is not None:
        query = query.where(Document.genre == config.sources.genre)
    if not config.sources.whole_shelf:
        ids = set(named or ())
        if names:
            ids |= set(
                session.exec(
                    select(Pill.document_id)
                    .where(col(Pill.retired_at).is_(None), concept_overlap(names))
                    .distinct()
                ).all()
            )
        query = query.where(col(Document.id).in_(list(ids)))
    return {d.id: d for d in session.exec(query.order_by(col(Document.title))).all()}


# --- Reading ------------------------------------------------------------------------------


def _reading(session: Session, documents: dict[uuid.UUID, Document]) -> dict[uuid.UUID, ReadState]:
    states = {
        doc_id: ReadState(finished=d.finished_at is not None) for doc_id, d in documents.items()
    }
    positions = session.exec(
        select(ReadingPosition)
        .where(col(ReadingPosition.document_id).in_(list(documents)))
        .order_by(col(ReadingPosition.updated_at))
    ).all()
    for position in positions:  # oldest first: the last one seen is the current unit
        state = states[position.document_id]
        state.progress[position.unit] = position.progress
        state.read_at[position.unit] = position.updated_at
        state.current = position.unit
    return states


def _units(
    session: Session, documents: dict[uuid.UUID, Document], reading: dict[uuid.UUID, ReadState]
) -> tuple[dict[uuid.UUID, list[str]], dict[tuple[uuid.UUID, str], str | None]]:
    """Per document, its chapters and the units that have pills or a reading position, in
    reading order (node ordinals)."""
    ids = list(documents)
    pairs = set(
        session.exec(
            select(Node.document_id, Node.anchor).where(
                col(Node.document_id).in_(ids), Node.kind == NodeKind.CHAPTER
            )
        ).all()
    )
    pairs |= set(
        session.exec(
            select(Pill.document_id, Pill.anchor)
            .where(col(Pill.retired_at).is_(None), col(Pill.document_id).in_(ids))
            .distinct()
        ).all()
    )
    pairs |= {(doc_id, unit) for doc_id, s in reading.items() for unit in s.progress}
    if not pairs:
        return {}, {}
    nodes = session.exec(
        select(Node.document_id, Node.anchor, Node.ordinal, Node.heading).where(
            tuple_(col(Node.document_id), col(Node.anchor)).in_(list(pairs))
        )
    ).all()
    ordinals = {(d, a): o for d, a, o, _ in nodes}
    titles = {(d, a): h for d, a, _, h in nodes}
    by_document: dict[uuid.UUID, list[tuple[float, str]]] = defaultdict(list)
    for doc_id, anchor in pairs:  # a unit without a node (gone) sorts last
        by_document[doc_id].append((ordinals.get((doc_id, anchor), float("inf")), anchor))
    return {d: [a for _, a in sorted(units)] for d, units in by_document.items()}, titles


def resolve(session: Session, config: FeedConfig) -> Scope:
    """The scope of `config` (unknown document, collection, paper set or concept id: 404)."""
    named = _named_documents(session, config)
    names = concept_names(session, config.sources.concepts)
    documents = _documents(session, config, named, names)
    reading = _reading(session, documents)
    units, titles = _units(session, documents, reading)
    scope = Scope(
        config=config,
        mode=config.mode,
        notice=None,
        documents=documents,
        named=named,
        concepts=names,
        reading=reading,
        units=units,
        titles=titles,
    )
    if config.mode is FeedMode.CONSOLIDATE and not any(scope.allowed(d) for d in documents):
        scope.mode, scope.notice = FeedMode.EXPLORE, NOTHING_READ
    return scope

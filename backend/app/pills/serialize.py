"""`pills` rows → the wire format (`contract.PillOut`), batched for a page of pills.

A pill on the wire is self-contained (L8): its document (slug, title, genre, catalogue
theme), its unit's title, its thread's size, and a `sources` entry for every cite. A bare
cite is an anchor of the pill's own document; `<slug>:<anchor>` (the convention of
`app.retrieval.evidence`) names another document's passage, resolved here by slug. A cite
whose document is gone is left out of `sources` (the cite stays: the client shows it inert).

    lookups = load_lookups(session, rows)       # five queries, whatever the page size
    pills = [to_wire(row, lookups) for row in rows]
"""

import uuid
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field

from sqlalchemy import func, tuple_
from sqlmodel import Session, col, select

from app.models import Document, Node
from app.models.pill import Pill
from app.pills.contract import DocumentRef, PillDocument, PillOut, PillSource, PillThread
from app.pipeline import catalogue
from app.retrieval.evidence import split_cite


@dataclass(slots=True)
class Lookups:
    documents: dict[uuid.UUID, Document] = field(default_factory=dict)
    themes: dict[uuid.UUID, str | None] = field(default_factory=dict)
    unit_titles: dict[tuple[uuid.UUID, str], str | None] = field(default_factory=dict)
    thread_sizes: dict[str, int] = field(default_factory=dict)
    by_slug: dict[str, Document] = field(default_factory=dict)  # documents cited by slug


def _cited_slugs(rows: Iterable[Pill]) -> set[str]:
    return {slug for row in rows for cite in row.cites if (slug := split_cite(cite)[0])}


def load_lookups(
    session: Session, rows: Sequence[Pill], *, extra_documents: Iterable[uuid.UUID] = ()
) -> Lookups:
    """Everything `to_wire` needs for `rows`. `extra_documents`: documents of pills built
    elsewhere (the feed's review pills) that should resolve too."""
    lookups = Lookups()
    doc_ids = {row.document_id for row in rows} | set(extra_documents)
    slugs = _cited_slugs(rows)
    if doc_ids or slugs:
        found = session.exec(
            select(Document).where(col(Document.id).in_(doc_ids) | col(Document.slug).in_(slugs))
        ).all()
        lookups.documents = {d.id: d for d in found}
        lookups.by_slug = {d.slug: d for d in found}
    lookups.themes = {
        doc_id: card.get("theme")
        for doc_id, card in catalogue.cards(session, list(doc_ids)).items()
    }
    units = {(row.document_id, row.anchor) for row in rows}
    if units:
        nodes = session.exec(
            select(Node.document_id, Node.anchor, Node.heading).where(
                tuple_(col(Node.document_id), col(Node.anchor)).in_(list(units))
            )
        ).all()
        lookups.unit_titles = {(d, a): h for d, a, h in nodes}
    threads = {row.thread_key for row in rows if row.thread_key}
    if threads:
        counts = session.exec(
            select(Pill.thread_key, func.count())
            .where(col(Pill.thread_key).in_(threads), col(Pill.retired_at).is_(None))
            .group_by(col(Pill.thread_key))
        ).all()
        lookups.thread_sizes = {str(key): int(n) for key, n in counts}
    return lookups


def document_out(document: Document, theme: str | None) -> PillDocument:
    return PillDocument(
        id=document.id,
        slug=document.slug,
        title=document.title,
        genre=document.genre,
        theme=theme,
    )


def document_ref(document: Document) -> DocumentRef:
    return DocumentRef(id=document.id, slug=document.slug, title=document.title)


def sources_for(
    document: Document, cites: Iterable[str], lookups: Lookups
) -> dict[str, PillSource]:
    """`cite → {document, anchor}` for every cite that resolves."""
    out: dict[str, PillSource] = {}
    for cite in cites:
        slug, anchor = split_cite(cite)
        target = document if slug is None else lookups.by_slug.get(slug)
        if target is not None:
            out[cite] = PillSource(document=document_ref(target), anchor=anchor)
    return out


def to_wire(row: Pill, lookups: Lookups) -> PillOut:
    """One stored pill on the wire. Its document must be in `lookups`."""
    document = lookups.documents[row.document_id]
    thread = None
    if row.thread_key is not None and row.thread_index is not None:
        size = max(lookups.thread_sizes.get(row.thread_key, 0), row.thread_index + 1)
        thread = PillThread(
            key=row.thread_key, index=row.thread_index, size=size, title=row.thread_title
        )
    return PillOut(
        id=row.id,
        kind=row.kind,
        document=document_out(document, lookups.themes.get(row.document_id)),
        anchor=row.anchor,
        unit_title=lookups.unit_titles.get((row.document_id, row.anchor)),
        headline=row.headline,
        body=row.body,
        cites=list(row.cites),
        sources=sources_for(document, row.cites, lookups),
        concepts=list(row.concepts),
        thread=thread,
        est_seconds=row.est_seconds,
        origin=row.origin,
        draft=row.draft,
        review_item_id=None,
    )


def serialize(session: Session, rows: Sequence[Pill]) -> list[PillOut]:
    """Rows → wire pills, in the same order."""
    lookups = load_lookups(session, rows)
    return [to_wire(row, lookups) for row in rows]

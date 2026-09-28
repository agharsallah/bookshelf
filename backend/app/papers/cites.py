"""The citation graph (docs/PAPERS.md §5): `document —cites→ document` edges between papers.

`paper_references.target_document_id` says a bibliography entry is on the shelf (set by
`papers.structure` and `papers.enrich`). Each such entry becomes one edge from the citing
paper to the cited document, derived and rebuilt like mention seeds:

* **Evidence** is where the paper cites it: the anchors behind its classified intent
  first (`intent_cites`), then every other in-text citation (`cited_at`), else the
  bibliography entry itself, qualified `<document_id>#<anchor>` like every edge's evidence.
* **Weight** follows the intent (`INTENT_WEIGHTS`): a work the paper extends or uses binds
  harder than one cited as background; `meta` keeps `intent` and `ordinal`.
* Edges land `accepted` with `origin = seed:cites@1`, and are reconciled per citing
  document (`edges.reconcile`): re-running is a no-op, a reference that leaves the shelf
  loses its edge, a human's edge on the same key is never touched.

`refresh(session, document_id)` re-seeds the document and every paper whose references point
at it (it may have just arrived on the shelf). The graph refresh (`graph.pipeline`) calls it
for every document, and the paper profile after structure, enrichment and an intent review;
it is a query per document, cheap enough to run inline.
"""

import uuid

from sqlmodel import Session, col, select

from app.graph.edges import EdgeDraft, EdgeKey, Reconciled, find_edge, origin_in, reconcile
from app.graph.refs import Ref
from app.models import Document, Edge, PaperReference, node_ref
from app.models.enums import CitationIntent, EntityKind, Relation

CITES_VERSION = "1"
CITES_ORIGIN = f"seed:cites@{CITES_VERSION}"
CITES_ORIGINS = ("seed:cites@%",)
MAX_EVIDENCE = 8
UNCLASSIFIED_WEIGHT = 0.5
INTENT_WEIGHTS: dict[CitationIntent, float] = {
    CitationIntent.EXTENDS: 1.0,
    CitationIntent.CONTRADICTS: 0.9,
    CitationIntent.USES: 0.8,
    CitationIntent.COMPARES: 0.7,
    CitationIntent.BACKGROUND: 0.4,
}


def _evidence(ref: PaperReference) -> list[str]:
    anchors = [*ref.intent_cites, *(a for a in ref.cited_at if a not in ref.intent_cites)]
    if not anchors and ref.anchor:
        anchors = [ref.anchor]
    return [node_ref(ref.document_id, a) for a in anchors[:MAX_EVIDENCE]]


def drafts(session: Session, document_id: uuid.UUID) -> list[EdgeDraft]:
    """The cites edges the document's bibliography asks for, in ordinal order."""
    rows = session.exec(
        select(PaperReference)
        .where(
            PaperReference.document_id == document_id,
            col(PaperReference.target_document_id).is_not(None),
            PaperReference.target_document_id != document_id,
        )
        .order_by(col(PaperReference.ordinal))
    ).all()
    out: list[EdgeDraft] = []
    for ref in rows:
        evidence = _evidence(ref)
        if not evidence or ref.target_document_id is None:
            continue
        out.append(
            EdgeDraft(
                src=Ref(EntityKind.DOCUMENT, str(document_id)),
                dst=Ref(EntityKind.DOCUMENT, str(ref.target_document_id)),
                relation=Relation.CITES,
                weight=INTENT_WEIGHTS[ref.intent] if ref.intent else UNCLASSIFIED_WEIGHT,
                evidence=evidence,
                origin=CITES_ORIGIN,
                meta={"ordinal": ref.ordinal, "intent": ref.intent.value if ref.intent else None},
            )
        )
    return out


def seed_document(session: Session, document_id: uuid.UUID) -> Reconciled:
    """Make the document's outgoing cites edges match its references. Flushes.

    `reconcile` keeps an existing edge's `meta`; a re-classified intent is written here
    (the first reference to a cited document speaks for the edge)."""
    wanted = drafts(session, document_id)
    report = reconcile(session, document_id, wanted, owns=CITES_ORIGINS)
    seen: set[EdgeKey] = set()
    for draft in wanted:
        if draft.key in seen:
            continue
        seen.add(draft.key)
        edge = find_edge(session, draft.key)
        if edge is not None and edge.origin == CITES_ORIGIN and edge.meta != draft.meta:
            edge.meta = dict(draft.meta)
            session.add(edge)
    session.flush()
    return report


def refresh(session: Session, document_id: uuid.UUID) -> Reconciled:
    """Re-seed the document and every paper citing it. Commits.

    A deleted document is re-seeded too (with no references it withdraws its outgoing
    edges), and its citers are found through their edges: the delete already cleared their
    references' `target_document_id` (`on delete set null`)."""
    report = Reconciled()
    citing = set(
        session.exec(
            select(PaperReference.document_id)
            .where(
                PaperReference.target_document_id == document_id,
                PaperReference.document_id != document_id,
            )
            .distinct()
        ).all()
    )
    if session.get(Document, document_id) is None:
        citing |= _citers_by_edge(session, document_id)
    for doc_id in sorted({*citing, document_id}, key=str):
        seeded = seed_document(session, doc_id)
        report.created += seeded.created
        report.updated += seeded.updated
        report.removed += seeded.removed
    session.commit()
    return report


def _citers_by_edge(session: Session, document_id: uuid.UUID) -> set[uuid.UUID]:
    rows = session.exec(
        select(Edge.src_id).where(
            Edge.relation == Relation.CITES,
            Edge.src_kind == EntityKind.DOCUMENT,
            Edge.dst_kind == EntityKind.DOCUMENT,
            Edge.dst_id == str(document_id),
            origin_in(CITES_ORIGINS),
        )
    ).all()
    return {uuid.UUID(src) for src in rows}

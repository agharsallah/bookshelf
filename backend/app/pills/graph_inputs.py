"""What harvests read from the idea graph (§11): accepted edges only.

* `claim_support`: per claim of the preferred claim_set, its accepted claim ↔ claim edges
  by relation (supports, contradicts, extends);
* `concept_index`: passage anchor → the concepts whose edges rest on it (a node endpoint or
  an evidence passage of this document), so pills can be scoped by concept;
* `connection_links`: edges whose evidence rests in this document *and* another one.

Evidence entries are qualified anchors, `<document_id>#<anchor>` (`app.graph.refs`).
"""

import uuid
from collections import defaultdict
from collections.abc import Iterable, Sequence

from sqlalchemy import ColumnElement, or_, text, tuple_
from sqlmodel import Session, col, select

from app.graph.refs import split_anchor
from app.models import Concept, Document, Edge, Node
from app.models.document import not_archived
from app.models.enums import EdgeStatus, EntityKind, Relation
from app.papers.claims import claim_id
from app.pills.harvest import ConnectionLink, LinkSide, SourceArtifact

SUPPORT_RELATIONS = (Relation.SUPPORTS, Relation.CONTRADICTS, Relation.EXTENDS)
CONNECTION_RELATIONS = (
    Relation.ECHOES,
    Relation.SUPPORTS,
    Relation.CONTRADICTS,
    Relation.EXTENDS,
    Relation.EXAMPLE_OF,
)
HEADLINE_CHARS = 80


def _on_document(document_id: uuid.UUID) -> ColumnElement[bool]:
    """`where` clause: the edge rests on the document (a node endpoint or an evidence)."""
    prefix = f"{document_id}#%"
    has_evidence = text(
        "exists (select 1 from unnest(edges.evidence) as ev where ev like :prefix)"
    ).bindparams(prefix=prefix)
    return or_(col(Edge.src_id).like(prefix), col(Edge.dst_id).like(prefix), has_evidence)


def claim_support(
    session: Session, document_id: uuid.UUID, claim_sets: Sequence[SourceArtifact]
) -> dict[uuid.UUID, dict[str, int]]:
    ids = {
        str(claim_id(document_id, str(c["text"])))
        for artifact in claim_sets
        for c in artifact.body.get("claims", [])
        if isinstance(c, dict) and c.get("text")
    }
    if not ids:
        return {}
    claim = EntityKind.CLAIM
    edges = session.exec(
        select(Edge).where(
            Edge.status == EdgeStatus.ACCEPTED,
            col(Edge.relation).in_(SUPPORT_RELATIONS),
            or_(
                (col(Edge.src_kind) == claim) & col(Edge.src_id).in_(ids),
                (col(Edge.dst_kind) == claim) & col(Edge.dst_id).in_(ids),
            ),
        )
    ).all()
    counts: dict[uuid.UUID, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for edge in edges:
        for kind, ref in ((edge.src_kind, edge.src_id), (edge.dst_kind, edge.dst_id)):
            if kind is EntityKind.CLAIM and ref in ids:
                counts[uuid.UUID(ref)][edge.relation.value] += 1
    return {cid: dict(by) for cid, by in counts.items()}


def _local_anchors(edge: Edge, document_id: uuid.UUID) -> list[str]:
    refs = [*edge.evidence]
    refs += [
        r
        for k, r in ((edge.src_kind, edge.src_id), (edge.dst_kind, edge.dst_id))
        if k is EntityKind.NODE
    ]
    return [p[1] for r in refs if (p := split_anchor(r)) and p[0] == document_id]


def concept_index(session: Session, document_id: uuid.UUID) -> dict[str, list[str]]:
    concept = EntityKind.CONCEPT
    edges = session.exec(
        select(Edge).where(
            Edge.status == EdgeStatus.ACCEPTED,
            or_(col(Edge.src_kind) == concept, col(Edge.dst_kind) == concept),
            _on_document(document_id),
        )
    ).all()
    wanted = {
        uuid.UUID(ref)
        for e in edges
        for kind, ref in ((e.src_kind, e.src_id), (e.dst_kind, e.dst_id))
        if kind is concept
    }
    names = _concept_names(session, wanted)
    index: dict[str, dict[str, None]] = defaultdict(dict)
    for edge in edges:
        named = [
            names[uuid.UUID(ref)]
            for kind, ref in ((edge.src_kind, edge.src_id), (edge.dst_kind, edge.dst_id))
            if kind is concept and uuid.UUID(ref) in names
        ]
        for anchor in _local_anchors(edge, document_id):
            index[anchor].update(dict.fromkeys(named))
    return {anchor: list(found) for anchor, found in index.items() if found}


def _concept_names(session: Session, ids: Iterable[uuid.UUID]) -> dict[uuid.UUID, str]:
    wanted = set(ids)
    if not wanted:
        return {}
    rows = session.exec(
        select(Concept).where(col(Concept.id).in_(wanted), col(Concept.merged_into).is_(None))
    ).all()
    return {c.id: c.canonical for c in rows}


def _texts(session: Session, pairs: set[tuple[uuid.UUID, str]]) -> dict[tuple[uuid.UUID, str], str]:
    if not pairs:
        return {}
    rows = session.exec(
        select(Node).where(tuple_(col(Node.document_id), col(Node.anchor)).in_(list(pairs)))
    ).all()
    return {(n.document_id, n.anchor): (n.text or n.heading or "") for n in rows}


def _headline(src: str | None, relation: Relation, dst: str | None) -> str | None:
    if src is None or dst is None:
        return None
    line = f"{src} {relation.value.replace('_', ' ')} {dst}"
    return line if len(line) <= HEADLINE_CHARS else None


def connection_links(session: Session, document: Document) -> list[ConnectionLink]:
    """Accepted edges with evidence in this document and another, this side first."""
    edges = session.exec(
        select(Edge)
        .where(
            Edge.status == EdgeStatus.ACCEPTED,
            col(Edge.relation).in_(CONNECTION_RELATIONS),
            _on_document(document.id),
        )
        .order_by(col(Edge.weight).desc(), col(Edge.id))
    ).all()
    picked: list[tuple[Edge, tuple[uuid.UUID, str], tuple[uuid.UUID, str]]] = []
    for edge in edges:
        parsed = [p for e in edge.evidence if (p := split_anchor(e))]
        mine = next((p for p in parsed if p[0] == document.id), None)
        other = next((p for p in parsed if p[0] != document.id), None)
        if mine is not None and other is not None:
            picked.append((edge, mine, other))
    if not picked:
        return []
    other_ids = {other[0] for _, _, other in picked}
    docs = {document.id: document} | {
        d.id: d
        for d in session.exec(
            select(Document).where(col(Document.id).in_(other_ids), not_archived())
        ).all()
    }
    texts = _texts(session, {p for _, mine, other in picked for p in (mine, other)})
    concepts = _concept_names(
        session,
        {
            uuid.UUID(ref)
            for edge, _, _ in picked
            for kind, ref in ((edge.src_kind, edge.src_id), (edge.dst_kind, edge.dst_id))
            if kind is EntityKind.CONCEPT
        },
    )
    links: list[ConnectionLink] = []
    for edge, mine, other in picked:
        if other[0] not in docs or mine not in texts or other not in texts:
            continue
        src = concepts.get(uuid.UUID(edge.src_id)) if edge.src_kind is EntityKind.CONCEPT else None
        dst = concepts.get(uuid.UUID(edge.dst_id)) if edge.dst_kind is EntityKind.CONCEPT else None
        sides = tuple(
            LinkSide(
                document_id=doc_id,
                slug=docs[doc_id].slug,
                title=docs[doc_id].title,
                anchor=anchor,
                text=texts[(doc_id, anchor)],
            )
            for doc_id, anchor in (mine, other)
        )
        links.append(
            ConnectionLink(
                edge_id=edge.id,
                relation=edge.relation.value,
                concept=src or dst,
                headline=_headline(src, edge.relation, dst),
                sides=(sides[0], sides[1]),
            )
        )
    return links

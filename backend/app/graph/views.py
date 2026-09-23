"""Read models for the graph API: typeahead, concept pages, proposals, neighborhoods.

Each view is a handful of queries whatever its size: labels and passages are hydrated in
batches (`app.graph.evidence`), never per edge.
"""

import uuid
from collections import defaultdict
from typing import Any, Literal

from sqlalchemy import Label, func, literal_column, text
from sqlmodel import Session, col, select

from app.graph import evidence as ev
from app.graph.merge import concept_edges
from app.graph.neighborhood import Neighborhood as Hood
from app.graph.refs import Ref
from app.models import Concept, Edge
from app.models.enums import ConceptKind, EdgeStatus, EntityKind, Relation
from app.schemas.graph import (
    ConceptDetail,
    ConceptEdge,
    ConceptPublic,
    ConceptSummary,
    DocumentRef,
    EdgeDetail,
    GraphEdge,
    GraphNode,
    MergeProposal,
    Neighborhood,
    Passage,
    RelationGroup,
)
from app.services.sql import escape_like

# Typeahead rank: exact name, name prefix, exact alias, alias prefix, then anywhere.
_RANK = """
    case
      when lower(concepts.canonical) = :q then 0
      when lower(concepts.canonical) like :prefix escape '\\' then 1
      when exists (select 1 from unnest(concepts.aliases) a where lower(a) = :q) then 2
      when exists (select 1 from unnest(concepts.aliases) a
                   where lower(a) like :prefix escape '\\') then 3
      else 4
    end
"""
_MATCH = """
    (lower(concepts.canonical) like :anywhere escape '\\'
     or exists (select 1 from unnest(concepts.aliases) a where lower(a) like :anywhere escape '\\'))
"""


def _doc(info: ev.DocInfo | None) -> DocumentRef | None:
    return DocumentRef(id=info.id, slug=info.slug, title=info.title) if info else None


def passage_out(p: ev.Passage) -> Passage:
    return Passage(
        ref=p.ref,
        document=_doc(p.document),
        anchor=p.anchor,
        kind=p.kind,
        heading=p.heading,
        snippet=p.snippet,
        exists=p.exists,
    )


def node_out(ref: Ref, label: ev.Label | None, **extra: Any) -> GraphNode:
    if label is None:  # the endpoint vanished (deleted document, re-parsed anchor)
        return GraphNode(id=str(ref), kind=ref.kind, label=ref.anchor or ref.id, **extra)
    return GraphNode(
        id=str(ref),
        kind=ref.kind,
        label=label.label,
        sublabel=label.sublabel,
        document=_doc(label.document),
        anchor=label.anchor,
        blurb=label.blurb,
        **extra,
    )


# Accepted edges of a concept with the concepts merged into it folded in; edges inside
# that group (the merge's own `same_as` record) are not connections. One correlated
# subquery per row of the page, served by the `edges_src_idx` / `edges_dst_idx` indexes.
_IN_GROUP = (
    "({x} = concepts.id::text or {x} in "
    "(select m.id::text from concepts m where m.merged_into = concepts.id))"
)
_SRC, _DST = _IN_GROUP.format(x="e.src_id"), _IN_GROUP.format(x="e.dst_id")
EDGE_COUNT: Label[int] = literal_column(
    f"""(select count(*) from edges e where e.status = 'accepted'
          and ((e.src_kind = 'concept' and {_SRC}) or (e.dst_kind = 'concept' and {_DST}))
          and not (e.src_kind = 'concept' and e.dst_kind = 'concept' and {_SRC} and {_DST}))"""  # noqa: S608  (constants only)
).label("edge_count")

ConceptSort = Literal["alpha", "connected", "recent"]


def search_concepts(
    session: Session,
    q: str | None,
    kind: ConceptKind | None,
    limit: int,
    offset: int,
    sort: ConceptSort = "alpha",
) -> tuple[list[ConceptSummary], int]:
    """Live concepts with their `edge_count`. With `q`, match rank comes first and `sort`
    breaks ties; `alpha` (default) is by name, `connected` most edges first, `recent`
    newest first."""
    query = select(Concept, EDGE_COUNT).where(col(Concept.merged_into).is_(None))
    if kind is not None:
        query = query.where(Concept.kind == kind)
    alpha = func.lower(Concept.canonical)
    orders: dict[str, list[Any]] = {
        "alpha": [alpha],
        "connected": [literal_column("edge_count").desc(), alpha],
        "recent": [col(Concept.created_at).desc(), alpha],
    }
    order = list(orders[sort])
    if q and q.strip():
        needle = escape_like(" ".join(q.lower().split()))
        params = {
            "q": " ".join(q.lower().split()),
            "prefix": f"{needle}%",
            "anywhere": f"%{needle}%",
        }
        query = query.where(text(_MATCH).bindparams(anywhere=params["anywhere"]))
        order.insert(0, text(_RANK).bindparams(q=params["q"], prefix=params["prefix"]))
    total = session.exec(select(func.count()).select_from(query.subquery())).one()
    rows = session.exec(query.order_by(*order, col(Concept.id)).offset(offset).limit(limit)).all()
    items = [
        ConceptSummary.model_validate(concept).model_copy(update={"edge_count": int(count)})
        for concept, count in rows
    ]
    return items, int(total)


def _ends(edge: Edge) -> tuple[Ref, Ref]:
    return Ref(edge.src_kind, edge.src_id), Ref(edge.dst_kind, edge.dst_id)


def concept_detail(session: Session, concept: Concept) -> ConceptDetail:
    me = Ref.concept(concept.id)
    edges = [
        e
        for e in concept_edges(session, concept.id)
        if e.status is not EdgeStatus.REJECTED and _ends(e)[0] != _ends(e)[1]
    ]
    others = [dst if src == me else src for src, dst in map(_ends, edges)]
    labels = ev.labels(session, others)
    found = ev.passages(session, [*concept.blurb_cites, *(r for e in edges for r in e.evidence)])
    groups: dict[Relation, list[ConceptEdge]] = defaultdict(list)
    ranked = sorted(
        zip(edges, others, strict=True), key=lambda p: -p[0].weight * max(len(p[0].evidence), 1)
    )
    for edge, other in ranked:
        groups[edge.relation].append(
            ConceptEdge(
                id=edge.id,
                relation=edge.relation,
                direction="out" if _ends(edge)[0] == me else "in",
                other=node_out(other, labels.get(other)),
                weight=edge.weight,
                status=edge.status,
                origin=edge.origin,
                evidence=[passage_out(found[r]) for r in edge.evidence if r in found],
            )
        )
    return ConceptDetail(
        concept=ConceptPublic.model_validate(concept),
        blurb_passages=[passage_out(found[r]) for r in concept.blurb_cites if r in found],
        relations=[RelationGroup(relation=rel, edges=items) for rel, items in groups.items()],
    )


def edge_detail(session: Session, edge: Edge) -> EdgeDetail:
    src, dst = _ends(edge)
    labels = ev.labels(session, [src, dst])
    found = ev.passages(session, edge.evidence)
    return EdgeDetail(
        id=edge.id,
        src=node_out(src, labels.get(src)),
        dst=node_out(dst, labels.get(dst)),
        relation=edge.relation,
        weight=edge.weight,
        status=edge.status,
        origin=edge.origin,
        evidence=[passage_out(found[r]) for r in edge.evidence if r in found],
        created_at=edge.created_at,
    )


def merge_proposals(session: Session, limit: int) -> list[MergeProposal]:
    edges = session.exec(
        select(Edge)
        .where(
            Edge.relation == Relation.SAME_AS,
            Edge.status == EdgeStatus.PROPOSED,
            Edge.src_kind == EntityKind.CONCEPT,
            Edge.dst_kind == EntityKind.CONCEPT,
        )
        .order_by(col(Edge.weight).desc(), col(Edge.created_at))
        .limit(limit)
    ).all()
    ids = {uuid.UUID(i) for e in edges for i in (e.src_id, e.dst_id)}
    concepts = {c.id: c for c in session.exec(select(Concept).where(col(Concept.id).in_(ids)))}
    found = ev.passages(session, [r for e in edges for r in e.evidence])
    out: list[MergeProposal] = []
    for edge in edges:
        a, b = concepts.get(uuid.UUID(edge.src_id)), concepts.get(uuid.UUID(edge.dst_id))
        if a is None or b is None or a.merged_into is not None or b.merged_into is not None:
            continue
        verdict = edge.meta  # dedup verdicts; a skill's own same_as carries none
        survivor = verdict.get("survivor")
        out.append(
            MergeProposal(
                edge_id=edge.id,
                a=ConceptSummary.model_validate(a),
                b=ConceptSummary.model_validate(b),
                similarity=verdict.get("similarity"),
                confidence=verdict.get("confidence"),
                rationale=verdict.get("rationale"),
                suggested_survivor=uuid.UUID(survivor) if survivor else None,
                origin=edge.origin,
                evidence=[passage_out(found[r]) for r in edge.evidence if r in found],
                created_at=edge.created_at,
            )
        )
    return out


def neighborhood_out(hood: Hood) -> Neighborhood:
    return Neighborhood(
        focus=str(hood.focus),
        depth=hood.depth,
        nodes=[
            node_out(n.ref, n.label, depth=n.depth, weight=round(n.weight, 4), more=n.more)
            for n in hood.nodes
        ],
        edges=[
            GraphEdge(
                id=e.id,
                src=str(e.src),
                dst=str(e.dst),
                relation=e.relation,
                weight=e.weight,
                evidence_count=e.evidence_count,
                status=e.status,
                origin=e.origin,
                edge_ids=e.edge_ids,
            )
            for e in hood.edges
        ],
        truncated=hood.truncated,
    )

"""One focal node's neighborhood (§11 navigation rules, D9).

    focus ─ recursive CTE over `edges` (both directions, depth ≤ 2, accepted edges; proposed
            too on request) ─ drop merged concepts ─ rank ─ cap at 150 nodes ─ hydrate

* **Focus** is any ref (`app.graph.refs`). A document focus stands for all of its passages:
  the walk starts from every node of the document that has an edge, and those nodes are
  folded into the document, so "this book" links straight to its concepts.
* **Ranking**: an edge scores `weight * max(evidence_count, 1)`; a node scores its best
  edge into the previous ring. Nodes are kept by ring, then score, until the cap.
* **Show more**: every returned node carries `more`, the number of its neighbors (at any
  depth) that were left out, so the UI can re-focus or expand; `truncated` says whether the
  cap cut anything. There is no global view: without a focus there is nothing to return.

The walk joins `edges` on `(src_kind, src_id)` and `(dst_kind, dst_id)`, the two indexed
column pairs, so it touches only the neighborhood, not the table.
"""

import math
import uuid
from collections import defaultdict
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field

from sqlalchemy import text
from sqlmodel import Session, col, select

from app.graph.evidence import Label, labels
from app.graph.refs import Ref
from app.models import Concept, Edge
from app.models.enums import EdgeStatus, EntityKind, Relation

MAX_DEPTH = 2
NODE_CAP = 150

Fold = Callable[[Ref], Ref]

_WALK = text(
    """
    with recursive walk(kind, id, depth) as (
        select s.kind, s.id, 0
        from unnest(cast(:kinds as text[]), cast(:ids as text[])) as s(kind, id)
      union
        select case when e.src_kind = w.kind and e.src_id = w.id
                    then e.dst_kind else e.src_kind end,
               case when e.src_kind = w.kind and e.src_id = w.id
                    then e.dst_id else e.src_id end,
               w.depth + 1
        from walk w
        join edges e
          on (e.src_kind = w.kind and e.src_id = w.id) or (e.dst_kind = w.kind and e.dst_id = w.id)
        where w.depth < :depth and e.status = any(cast(:statuses as text[]))
    )
    select kind, id, min(depth) as depth from walk group by kind, id
    """
)
_INDUCED = text(
    """
    with r(kind, id) as (
        select * from unnest(cast(:kinds as text[]), cast(:ids as text[]))
    )
    select e.id from edges e
    join r a on a.kind = e.src_kind and a.id = e.src_id
    join r b on b.kind = e.dst_kind and b.id = e.dst_id
    where e.status = any(cast(:statuses as text[]))
    """
)
_NEIGHBORS = text(
    """
    with r(kind, id) as (
        select * from unnest(cast(:kinds as text[]), cast(:ids as text[]))
    )
    select r.kind, r.id, array_agg(distinct
             case when e.src_kind = r.kind and e.src_id = r.id
                  then e.dst_kind || ':' || e.dst_id else e.src_kind || ':' || e.src_id end)
    from r
    join edges e
      on (e.src_kind = r.kind and e.src_id = r.id) or (e.dst_kind = r.kind and e.dst_id = r.id)
    where e.status = any(cast(:statuses as text[]))
    group by r.kind, r.id
    """
)


@dataclass(slots=True)
class GraphNode:
    ref: Ref
    depth: int
    weight: float = 0.0
    more: int = 0
    label: Label | None = None


@dataclass(slots=True)
class GraphEdge:
    id: uuid.UUID
    src: Ref
    dst: Ref
    relation: Relation
    weight: float
    evidence_count: int
    status: EdgeStatus
    origin: str
    edge_ids: list[uuid.UUID] = field(default_factory=list)  # >1 when folded into a document

    @property
    def score(self) -> float:
        return self.weight * max(self.evidence_count, 1)


@dataclass(slots=True)
class Neighborhood:
    focus: Ref
    depth: int
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    truncated: bool


def _arrays(refs: list[Ref]) -> dict[str, list[str]]:
    return {"kinds": [r.kind.value for r in refs], "ids": [r.id for r in refs]}


def _seeds(session: Session, focus: Ref) -> list[Ref]:
    if focus.kind is not EntityKind.DOCUMENT:
        return [focus]
    prefix = f"{focus.id}#%"
    rows = session.execute(
        text(
            "select src_id from edges where src_kind = 'node' and src_id like :p "
            "union select dst_id from edges where dst_kind = 'node' and dst_id like :p"
        ),
        {"p": prefix},
    ).all()
    return [focus, *(Ref(EntityKind.NODE, row[0]) for row in rows)]


def neighborhood(
    session: Session,
    focus: Ref,
    *,
    depth: int = 1,
    include_proposed: bool = False,
    cap: int = NODE_CAP,
) -> Neighborhood:
    depth = min(max(depth, 1), MAX_DEPTH)
    statuses = [EdgeStatus.ACCEPTED.value] + (
        [EdgeStatus.PROPOSED.value] if include_proposed else []
    )
    seeds = _seeds(session, focus)
    folded = {s for s in seeds if s != focus}  # a document's own passages

    def fold(ref: Ref) -> Ref:
        return focus if ref in folded else ref

    rows = session.execute(_WALK, {**_arrays(seeds), "depth": depth, "statuses": statuses}).all()
    reached = {Ref(EntityKind(k), i): d for k, i, d in rows}
    merged = _merged(session, [r for r in reached if r.kind is EntityKind.CONCEPT])
    reached = {r: d for r, d in reached.items() if r not in merged}

    ids = session.execute(_INDUCED, {**_arrays(list(reached)), "statuses": statuses}).all()
    rows_e = session.exec(select(Edge).where(col(Edge.id).in_([r[0] for r in ids]))).all()
    edges = _collapse(rows_e, fold)

    nodes: dict[Ref, GraphNode] = {}
    for ref, d in reached.items():
        target = fold(ref)
        if target not in nodes or d < nodes[target].depth:
            nodes[target] = GraphNode(ref=target, depth=0 if target == focus else d)
    _score(nodes, edges, focus)
    ordered = sorted(
        nodes.values(),
        key=lambda n: (n.ref != focus, n.depth, -n.weight, str(n.ref)),
    )
    kept = {n.ref: n for n in ordered[:cap]}
    kept_edges = sorted(
        (e for e in edges if e.src in kept and e.dst in kept),
        key=lambda e: (-e.score, str(e.id)),
    )
    _more(session, kept, kept_edges, folded, fold, statuses, merged)
    found = labels(session, list(kept))
    for node in kept.values():
        node.label = found.get(node.ref)
    return Neighborhood(
        focus=focus,
        depth=depth,
        nodes=list(kept.values()),
        edges=kept_edges,
        truncated=len(nodes) > cap,
    )


def _merged(session: Session, refs: list[Ref]) -> set[Ref]:
    if not refs:
        return set()
    rows = session.exec(
        select(Concept.id).where(
            col(Concept.id).in_([r.uuid for r in refs]), col(Concept.merged_into).is_not(None)
        )
    ).all()
    return {Ref.concept(row) for row in rows}


def _collapse(rows: Sequence[Edge], fold: Fold) -> list[GraphEdge]:
    """Map endpoints through `fold`, drop self-loops, combine edges that became one."""
    combined: dict[tuple[Ref, Ref, Relation], GraphEdge] = {}
    for edge in sorted(rows, key=lambda e: (-(e.weight * max(len(e.evidence), 1)), str(e.id))):
        src = fold(Ref(edge.src_kind, edge.src_id))
        dst = fold(Ref(edge.dst_kind, edge.dst_id))
        if src == dst:
            continue
        key = (src, dst, edge.relation)
        seen = combined.get(key)
        if seen is None:
            combined[key] = GraphEdge(
                id=edge.id,
                src=src,
                dst=dst,
                relation=edge.relation,
                weight=edge.weight,
                evidence_count=len(edge.evidence),
                status=edge.status,
                origin=edge.origin,
                edge_ids=[edge.id],
            )
        else:  # the strongest edge (sorted first) stays the representative
            seen.evidence_count += len(edge.evidence)
            seen.edge_ids.append(edge.id)
    return list(combined.values())


def _score(nodes: dict[Ref, GraphNode], edges: list[GraphEdge], focus: Ref) -> None:
    best: dict[Ref, float] = defaultdict(float)
    for edge in edges:
        for near, far in ((edge.src, edge.dst), (edge.dst, edge.src)):
            if near in nodes and far in nodes and nodes[near].depth == nodes[far].depth - 1:
                best[far] = max(best[far], edge.score)
    for ref, node in nodes.items():
        node.weight = best.get(ref, 0.0)
    if focus in nodes:
        top = max((e.score for e in edges), default=1.0)
        nodes[focus].weight = top if math.isfinite(top) else 1.0


def _more(
    session: Session,
    kept: dict[Ref, GraphNode],
    kept_edges: list[GraphEdge],
    folded: set[Ref],
    fold: Fold,
    statuses: list[str],
    merged: set[Ref],
) -> None:
    """`more` = neighbors of each kept node (any depth) that the response leaves out."""
    asked = [*kept, *folded]
    rows = session.execute(_NEIGHBORS, {**_arrays(asked), "statuses": statuses}).all()
    everyone: dict[Ref, set[Ref]] = defaultdict(set)
    for kind, ref_id, others in rows:
        owner = fold(Ref(EntityKind(kind), ref_id))
        for other in others:
            other_kind, _, other_id = other.partition(":")
            neighbor = fold(Ref(EntityKind(other_kind), other_id))
            if neighbor != owner and neighbor not in merged:
                everyone[owner].add(neighbor)
    shown: dict[Ref, set[Ref]] = defaultdict(set)
    for edge in kept_edges:
        shown[edge.src].add(edge.dst)
        shown[edge.dst].add(edge.src)
    for ref, node in kept.items():
        node.more = len(everyone[ref] - shown[ref])

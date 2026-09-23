"""Synthesis over the idea graph (§10: "multi-document distillation retrieval +
`contradicts` edges").

For a synthesis query, the accepted concept-to-concept `contradicts` / `supports` /
`extends` edges whose evidence lies in the documents the search returned, strongest
disagreements first. Evidence is reported as `<slug>:<anchor>` (the answer's cite form),
restricted to those documents. Kept small (`MAX_RELATIONS`): it steers the answer, it is
not a graph view.
"""

import uuid
from collections.abc import Sequence

from sqlalchemy import text
from sqlmodel import Session, col, select

from app.graph.refs import split_anchor
from app.models import Concept, Edge
from app.models.enums import EdgeStatus, EntityKind, Relation
from app.schemas.search import ConceptEnd, ConceptRelation, DocumentRef, RelationName

# In prompt and sort order: disagreements first.
NAMES: dict[Relation, RelationName] = {
    Relation.CONTRADICTS: "contradicts",
    Relation.SUPPORTS: "supports",
    Relation.EXTENDS: "extends",
}
RELATIONS = tuple(NAMES)
MAX_RELATIONS = 12
_ORDER: dict[str, int] = {name: rank for rank, name in enumerate(NAMES.values())}

# Any evidence anchor (`<document_id>#<anchor>`) inside one of the documents.
_EVIDENCED_IN = text(
    "exists (select 1 from unnest(edges.evidence) as e "
    "where split_part(e, '#', 1) = any(:documents))"
)


def between(session: Session, documents: Sequence[DocumentRef]) -> list[ConceptRelation]:
    """Accepted concept relations evidenced in `documents`, contradictions first."""
    by_id = {str(d.id): d for d in documents}
    if not by_id:
        return []
    edges = session.exec(
        select(Edge).where(
            Edge.src_kind == EntityKind.CONCEPT,
            Edge.dst_kind == EntityKind.CONCEPT,
            col(Edge.relation).in_(list(RELATIONS)),
            Edge.status == EdgeStatus.ACCEPTED,
            _EVIDENCED_IN.bindparams(documents=list(by_id)),
        )
    ).all()
    ids = {uuid.UUID(i) for e in edges for i in (e.src_id, e.dst_id)}
    concepts = {c.id: c for c in session.exec(select(Concept).where(col(Concept.id).in_(ids)))}
    relations = []
    for edge in edges:
        src, dst = concepts.get(uuid.UUID(edge.src_id)), concepts.get(uuid.UUID(edge.dst_id))
        if src is None or dst is None:
            continue
        evidence = []
        for ref in edge.evidence:
            split = split_anchor(ref)
            if split is not None and str(split[0]) in by_id:
                evidence.append(f"{by_id[str(split[0])].slug}:{split[1]}")
        relations.append(
            ConceptRelation(
                relation=NAMES[edge.relation],
                src=ConceptEnd(id=src.id, canonical=src.canonical),
                dst=ConceptEnd(id=dst.id, canonical=dst.canonical),
                weight=edge.weight,
                evidence=sorted(evidence),
            )
        )
    relations.sort(key=lambda r: (_ORDER[r.relation], -r.weight, -len(r.evidence)))
    return relations[:MAX_RELATIONS]


def prompt_section(relations: Sequence[ConceptRelation]) -> str:
    """The relations as prompt lines for the answer (empty when there are none)."""
    if not relations:
        return ""
    lines = [
        f"- {r.src.canonical} {r.relation.upper()} {r.dst.canonical} "
        f"(evidence: {', '.join(r.evidence)})"
        for r in relations
    ]
    return (
        "## Relations between concepts\n\nFrom the reader's idea graph (accepted edges). Use "
        "them to structure agreements and disagreements; cite the evidence passages, not "
        "these lines.\n\n" + "\n".join(lines) + "\n"
    )

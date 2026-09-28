"""The claim tracker's reads (docs/PAPERS.md §5, §7): a paper's claims with the shelf's
verdicts on them, one claim's relations, the reader's margin marks; and queueing the
cross-paper pass. Counting rules are in `app.schemas.paper_claims`.
"""

import uuid
from collections import defaultdict
from collections.abc import Iterable

from sqlalchemy import or_
from sqlmodel import Session, col, select

from app.core.errors import NotFoundError
from app.graph import evidence as ev
from app.graph.views import passage_out
from app.jobs.queue import enqueue
from app.models import Claim, Document, Edge
from app.models.enums import ArtifactType, EdgeStatus, EntityKind, Relation
from app.papers.claim_pairs import relate_spec
from app.papers.materialize import effective
from app.papers.units import role_of, units
from app.pipeline.tree import Tree
from app.schemas.graph import DocumentRef
from app.schemas.paper_claims import (
    ClaimMark,
    ClaimMarks,
    ClaimRelation,
    ClaimRelationCounts,
    ClaimRelations,
    ClaimUnitGroup,
    ClaimWithRelations,
    MarkedClaim,
    PaperClaims,
)
from app.schemas.papers import ClaimPublic


def _claims(session: Session, document_id: uuid.UUID) -> list[Claim]:
    rows = session.exec(select(Claim).where(Claim.document_id == document_id)).all()
    return sorted(rows, key=lambda c: (len(c.key), c.key))  # C2 before C10


def claim_edges(session: Session, claim_ids: Iterable[str]) -> list[Edge]:
    """Every non-rejected claim ↔ claim edge touching one of `claim_ids`."""
    ids = list(claim_ids)
    if not ids:
        return []
    rows = session.exec(
        select(Edge).where(
            Edge.src_kind == EntityKind.CLAIM,
            Edge.dst_kind == EntityKind.CLAIM,
            Edge.status != EdgeStatus.REJECTED,
            or_(col(Edge.src_id).in_(ids), col(Edge.dst_id).in_(ids)),
        )
    ).all()
    return list(rows)


def relation_counts(session: Session, claim_ids: Iterable[str]) -> dict[str, ClaimRelationCounts]:
    """Claim id → its counts (every id present, zeros when nothing relates to it)."""
    ids = list(claim_ids)
    counts = {cid: ClaimRelationCounts() for cid in ids}
    for edge in claim_edges(session, ids):
        for me, outgoing in ((edge.src_id, True), (edge.dst_id, False)):
            c = counts.get(me)
            if c is None:
                continue
            if edge.status is EdgeStatus.PROPOSED:
                c.proposed += 1
            elif edge.relation is Relation.CONTRADICTS:
                c.contradicted_by += 1
            elif edge.relation is Relation.SUPPORTS and outgoing:
                c.supports += 1
            elif edge.relation is Relation.SUPPORTS:
                c.supported_by += 1
            elif edge.relation is Relation.EXTENDS and outgoing:
                c.extends += 1
            elif edge.relation is Relation.EXTENDS:
                c.extended_by += 1
    return counts


def paper_claims(session: Session, document: Document) -> PaperClaims:
    """The paper's claims grouped by unit in reading order (the abstract's last)."""
    rows = _claims(session, document.id)
    counts = relation_counts(session, [str(c.id) for c in rows])
    by_unit: dict[str | None, list[ClaimWithRelations]] = defaultdict(list)
    for claim in rows:
        public = ClaimPublic.model_validate(claim).model_dump()
        by_unit[claim.unit].append(ClaimWithRelations(**public, relations=counts[str(claim.id)]))
    groups = []
    for unit in units(Tree.load(session, document)):
        if unit.anchor in by_unit:
            role = role_of(unit)
            groups.append(
                ClaimUnitGroup(
                    unit=unit.anchor,
                    heading=unit.heading,
                    role=role.value if role else None,
                    claims=by_unit.pop(unit.anchor),
                )
            )
    for unit_anchor, claims in sorted(by_unit.items(), key=lambda kv: (kv[0] is None, kv[0] or "")):
        groups.append(ClaimUnitGroup(unit=unit_anchor, heading=None, role=None, claims=claims))
    artifact = effective(session, document.id, ArtifactType.CLAIM_SET)
    return PaperClaims(
        document_id=document.id,
        artifact_id=artifact.id if artifact else None,
        total=len(rows),
        units=groups,
    )


def _doc_ref(info: ev.DocInfo | None) -> DocumentRef | None:
    return DocumentRef(id=info.id, slug=info.slug, title=info.title) if info else None


def claim_relations(session: Session, claim_id: uuid.UUID) -> ClaimRelations:
    """One claim and every live relation on it (accepted first, strongest first)."""
    claim = session.get(Claim, claim_id)
    if claim is None:
        raise NotFoundError(f"Claim {claim_id} does not exist.")
    me = str(claim.id)
    edges = claim_edges(session, [me])
    others = {e.dst_id if e.src_id == me else e.src_id for e in edges}
    other_rows = {
        str(c.id): c
        for c in session.exec(
            select(Claim).where(col(Claim.id).in_([uuid.UUID(o) for o in others]))
        ).all()
    }
    docs = ev.documents(session, {claim.document_id, *(c.document_id for c in other_rows.values())})
    found = ev.passages(session, [r for e in edges for r in e.evidence])
    ranked = sorted(
        edges,
        key=lambda e: (e.status is not EdgeStatus.ACCEPTED, -e.weight, str(e.id)),
    )
    relations = []
    for edge in ranked:
        other_id = edge.dst_id if edge.src_id == me else edge.src_id
        other = other_rows.get(other_id)
        if other is None:
            continue
        relations.append(
            ClaimRelation(
                edge_id=edge.id,
                relation=edge.relation,
                direction="out" if edge.src_id == me else "in",
                status=edge.status,
                weight=edge.weight,
                confidence=edge.meta.get("confidence"),
                rationale=edge.meta.get("rationale"),
                other=ClaimPublic.model_validate(other),
                other_document=_doc_ref(docs.get(other.document_id)),
                evidence=[passage_out(found[r]) for r in edge.evidence if r in found],
            )
        )
    return ClaimRelations(
        claim=ClaimPublic.model_validate(claim),
        document=_doc_ref(docs.get(claim.document_id)),
        relations=relations,
    )


def _in_unit(anchor: str, unit: str | None) -> bool:
    return unit is None or anchor == unit or anchor.startswith(unit + "/")


def claim_marks(session: Session, document: Document, unit: str | None) -> ClaimMarks:
    """Evidence anchor → the claims resting on it and the shelf's accepted verdicts on
    them, for the reader's margin ("supported by 1 · contradicted by 2")."""
    rows = _claims(session, document.id)
    counts = relation_counts(session, [str(c.id) for c in rows])
    marks: dict[str, ClaimMark] = {}
    for claim in rows:
        c = counts[str(claim.id)]
        for anchor in claim.evidence:
            if not _in_unit(anchor, unit):
                continue
            mark = marks.setdefault(
                anchor,
                ClaimMark(anchor=anchor, claims=[], supported_by=0, contradicted_by=0,
                          extended_by=0),
            )  # fmt: skip
            mark.claims.append(
                MarkedClaim(id=claim.id, key=claim.key, strength=claim.strength.value)
            )
            mark.supported_by += c.supported_by
            mark.contradicted_by += c.contradicted_by
            mark.extended_by += c.extended_by
    order = {n.anchor: i for i, n in enumerate(Tree.load(session, document).walk())}
    ranked = sorted(marks.values(), key=lambda m: (order.get(m.anchor, 1 << 30), m.anchor))
    return ClaimMarks(document_id=document.id, unit=unit, marks=ranked)


def queue_relate(session: Session, document_id: uuid.UUID | None = None) -> list[uuid.UUID]:
    """A manual `relate_claims` job per paper with claims (or for one paper)."""
    query = select(Claim.document_id).distinct()
    if document_id is not None:
        query = query.where(Claim.document_id == document_id)
    papers = sorted(session.exec(query).all(), key=str)
    return [job.id for doc in papers if (job := enqueue(session, relate_spec(doc, ["manual"])))]

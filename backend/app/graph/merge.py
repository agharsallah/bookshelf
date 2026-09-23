"""Human-confirmed concept merges (§11: "merges are applied by a human, never automatically").

`merge(loser, survivor)`:

* marks the `same_as` edge(s) between the two `accepted` (or records one, origin `human`);
* repoints every other edge of the loser to the survivor. Where that collides with an edge
  the survivor already has (the unique `(src, dst, relation)` key), the two are combined:
  max weight, union of evidence, the stronger status (accepted > proposed > rejected).
  Edges that would become self-loops are dropped;
* copies the loser's canonical and aliases onto the survivor, and its blurb if the survivor
  has none; sets `loser.merged_into` (concepts merged into the loser follow along).

The loser row stays, hidden everywhere by `merged_into`, so `unmerge` can bring it back:
it clears `merged_into`, takes the loser's names off the survivor, reopens the `same_as`
proposal, marks the restored concept `origin = human` (so a re-sync never garbage-collects
it, even when no artifact backs its edges any more), and re-syncs the documents that back
either side so skill edges find the loser again. Hand-drawn edges that were repointed stay
on the survivor.
"""

import uuid

from sqlalchemy import or_
from sqlmodel import Session, col, select

from app.graph import names
from app.graph.apply import sync_document
from app.graph.edges import HUMAN, EdgeKey, find_edge, union
from app.graph.refs import split_anchor
from app.models import Concept, Edge
from app.models.enums import EdgeStatus, EntityKind, Origin, Relation

_STRENGTH = {EdgeStatus.REJECTED: 0, EdgeStatus.PROPOSED: 1, EdgeStatus.ACCEPTED: 2}


class MergeError(ValueError):
    """The merge (or unmerge) makes no sense for these concepts."""


def concept_edges(session: Session, concept_id: uuid.UUID) -> list[Edge]:
    ref = str(concept_id)
    return list(
        session.exec(
            select(Edge).where(
                or_(
                    (col(Edge.src_kind) == EntityKind.CONCEPT) & (col(Edge.src_id) == ref),
                    (col(Edge.dst_kind) == EntityKind.CONCEPT) & (col(Edge.dst_id) == ref),
                )
            )
        ).all()
    )


def _pair_edges(session: Session, a: uuid.UUID, b: uuid.UUID) -> list[Edge]:
    pair = {str(a), str(b)}
    return [
        e
        for e in concept_edges(session, a)
        if e.relation is Relation.SAME_AS
        and e.src_kind is EntityKind.CONCEPT
        and e.dst_kind is EntityKind.CONCEPT
        and {e.src_id, e.dst_id} == pair
    ]


def _repointed(edge: Edge, loser: str, survivor: str) -> EdgeKey:
    src = survivor if edge.src_kind is EntityKind.CONCEPT and edge.src_id == loser else edge.src_id
    dst = survivor if edge.dst_kind is EntityKind.CONCEPT and edge.dst_id == loser else edge.dst_id
    return (edge.src_kind, src, edge.dst_kind, dst, edge.relation)


def _combine(into: Edge, other: Edge) -> None:
    into.weight = max(into.weight, other.weight)
    into.evidence = union(into.evidence, other.evidence)
    if _STRENGTH[other.status] > _STRENGTH[into.status]:
        into.status = other.status


def _get(session: Session, concept_id: uuid.UUID) -> Concept:
    concept = session.get(Concept, concept_id)
    if concept is None:
        raise MergeError(f"Concept {concept_id} does not exist.")
    return concept


def merge(session: Session, loser_id: uuid.UUID, survivor_id: uuid.UUID) -> Concept:
    """Merge `loser` into `survivor`. Returns the survivor. Commits."""
    loser, survivor = _get(session, loser_id), _get(session, survivor_id)
    if loser.merged_into is not None:
        raise MergeError(f"{loser.canonical!r} is already merged.")
    if survivor.merged_into is not None:
        raise MergeError(f"{survivor.canonical!r} is merged; merge into its survivor instead.")
    if loser.id == survivor.id:
        raise MergeError("A concept cannot be merged into itself.")

    pair = _pair_edges(session, loser.id, survivor.id)
    for edge in pair:
        edge.status = EdgeStatus.ACCEPTED
        session.add(edge)
    if not pair:  # a merge from the concept page, without a proposal: record it
        record = Edge(src_kind=EntityKind.CONCEPT, src_id=str(loser.id),
                      dst_kind=EntityKind.CONCEPT, dst_id=str(survivor.id),
                      relation=Relation.SAME_AS, weight=1.0,
                      evidence=union(loser.blurb_cites, survivor.blurb_cites), origin=HUMAN,
                      status=EdgeStatus.ACCEPTED)  # fmt: skip
        session.add(record)
        session.flush()
        pair = [record]
    pair_ids = {e.id for e in pair}
    old, new = str(loser.id), str(survivor.id)
    for edge in concept_edges(session, loser.id):
        if edge.id in pair_ids:
            continue
        key = _repointed(edge, old, new)
        if (key[0], key[1]) == (key[2], key[3]):
            session.delete(edge)
        elif (existing := find_edge(session, key)) is not None and existing.id != edge.id:
            _combine(existing, edge)
            session.add(existing)
            session.delete(edge)
        else:
            edge.src_id, edge.dst_id = key[1], key[3]
            session.add(edge)
        session.flush()

    survivor.aliases = names.merged_aliases(
        survivor.aliases, [loser.canonical, *loser.aliases], survivor.canonical
    )
    if not survivor.blurb and loser.blurb:
        survivor.blurb, survivor.blurb_cites = loser.blurb, list(loser.blurb_cites)
    loser.merged_into = survivor.id
    survivor.origin = Origin.HUMAN  # a person decided what it stands for
    for child in session.exec(select(Concept).where(Concept.merged_into == loser.id)).all():
        child.merged_into = survivor.id
        session.add(child)
    session.add_all([loser, survivor])
    session.commit()
    session.refresh(survivor)
    return survivor


def _backing_documents(session: Session, concepts: list[Concept]) -> set[uuid.UUID]:
    evidence = [e for c in concepts for edge in concept_edges(session, c.id) for e in edge.evidence]
    evidence += [cite for c in concepts for cite in c.blurb_cites]
    return {parts[0] for e in evidence if (parts := split_anchor(e)) is not None}


def unmerge(session: Session, loser_id: uuid.UUID) -> Concept:
    """Undo a merge. Returns the restored concept. Commits."""
    loser = _get(session, loser_id)
    if loser.merged_into is None:
        raise MergeError(f"{loser.canonical!r} is not merged.")
    survivor = _get(session, loser.merged_into)
    taken = {names.normalize(n) for n in [loser.canonical, *loser.aliases]}
    survivor.aliases = [a for a in survivor.aliases if names.normalize(a) not in taken]
    loser.merged_into = None
    # A person just decided it stands on its own: curated, so the re-sync below (which
    # garbage-collects skill concepts no artifact backs any more) must never delete it.
    loser.origin = Origin.HUMAN
    for edge in _pair_edges(session, loser.id, survivor.id):
        edge.status = EdgeStatus.PROPOSED
        session.add(edge)
    session.add_all([loser, survivor])
    session.commit()
    for document_id in sorted(_backing_documents(session, [survivor, loser])):
        sync_document(session, document_id)
    session.refresh(loser)
    return loser

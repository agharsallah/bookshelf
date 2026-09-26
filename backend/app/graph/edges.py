"""Edge keys, origins, and `reconcile`: one document's share of a class of edges.

Every edge records who made it (`origin`), so machine proposals and human curation stay
apart (§11):

    human                                 curated by hand; never touched by automation
    skill:link-concepts@<v>#<artifact>    from a `concept_links` artifact (`apply`)
    human:concept_links#<artifact>        from a human-authored/edited `concept_links`
    seed:diagram@<v>#<artifact>           from a diagram in a `figure_description`
    seed:mentions@<v>                     a section naming a known concept (`mentions`)
    seed:semantic@<v>                     Qdrant: echoing chapters, paraphrasing passages
    skill:confirm-merge@<v>               a dedup verdict on a `same_as` pair

An edge is unique per `(src, dst, relation)`, so two books asserting "little's law supports
wip limit" share one row. A document's contribution to a shared edge is the evidence
qualified with its id (`<document_id>#<anchor>`), which is what makes `reconcile` exact:
it replaces that document's evidence, deletes an edge only when nothing else backs it,
and hands ownership (`origin`) to a remaining contributor. It never resurrects a status a
human set, and never rewrites an edge of a class it does not own.
"""

import uuid
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import ColumnElement, or_, text
from sqlmodel import Session, col, select

from app.graph.refs import Ref, split_anchor
from app.models import Artifact, Edge
from app.models.enums import EdgeStatus, EntityKind, Origin, Relation

HUMAN = "human"
LINK_ORIGINS = ("skill:link-concepts@%", "human:concept_links#%")
DIAGRAM_ORIGINS = ("seed:diagram@%",)
MENTION_ORIGINS = ("seed:mentions@%",)
SEMANTIC_ORIGINS = ("seed:semantic@%",)
# Seeds are candidates: a skill edge adopts one, and seeds alone never keep a concept alive.
SEED_ORIGINS = DIAGRAM_ORIGINS + MENTION_ORIGINS + SEMANTIC_ORIGINS
DEDUP_ORIGIN_PREFIX = "skill:confirm-merge@"

EdgeKey = tuple[EntityKind, str, EntityKind, str, Relation]


def artifact_origin(artifact: Artifact) -> str:
    """The `origin` of every edge an artifact contributes."""
    if artifact.origin is Origin.SKILL:
        return f"skill:{artifact.skill}@{artifact.skill_version}#{artifact.id}"
    return f"human:{artifact.type.value}#{artifact.id}"


def origin_artifact_id(origin: str) -> uuid.UUID | None:
    _, sep, tail = origin.rpartition("#")
    if not sep:
        return None
    try:
        return uuid.UUID(tail)
    except ValueError:
        return None


def origin_in(origins: Sequence[str]) -> ColumnElement[bool]:
    return or_(*[col(Edge.origin).like(pattern) for pattern in origins])


def _matches(origin: str, patterns: Sequence[str]) -> bool:
    return any(origin.startswith(p.rstrip("%")) for p in patterns)


def edge_key(edge: Edge) -> EdgeKey:
    return (edge.src_kind, edge.src_id, edge.dst_kind, edge.dst_id, edge.relation)


def find_edge(session: Session, key: EdgeKey) -> Edge | None:
    src_kind, src_id, dst_kind, dst_id, relation = key
    return session.exec(
        select(Edge).where(
            Edge.src_kind == src_kind,
            Edge.src_id == src_id,
            Edge.dst_kind == dst_kind,
            Edge.dst_id == dst_id,
            Edge.relation == relation,
        )
    ).first()


def union(*lists: Iterable[str]) -> list[str]:
    """Order-preserving union."""
    out: list[str] = []
    for items in lists:
        out.extend(item for item in items if item not in out)
    return out


@dataclass(slots=True)
class EdgeDraft:
    src: Ref
    dst: Ref
    relation: Relation
    weight: float
    evidence: list[str]
    origin: str
    status: EdgeStatus = EdgeStatus.ACCEPTED
    meta: dict[str, Any] = field(default_factory=dict)

    @property
    def key(self) -> EdgeKey:
        return (self.src.kind, self.src.id, self.dst.kind, self.dst.id, self.relation)

    def row(self) -> Edge:
        return Edge(
            src_kind=self.src.kind,
            src_id=self.src.id,
            dst_kind=self.dst.kind,
            dst_id=self.dst.id,
            relation=self.relation,
            weight=self.weight,
            evidence=list(self.evidence),
            origin=self.origin,
            status=self.status,
            meta=dict(self.meta),
        )


@dataclass(slots=True)
class Reconciled:
    created: int = 0
    updated: int = 0
    removed: int = 0
    kept: int = 0  # desired, but an edge of another class (human, dedup) already holds the key
    concepts: set[uuid.UUID] = field(default_factory=set)  # endpoints of anything changed

    def touch(self, edge: Edge) -> None:
        for kind, ref in ((edge.src_kind, edge.src_id), (edge.dst_kind, edge.dst_id)):
            if kind is EntityKind.CONCEPT:
                self.concepts.add(uuid.UUID(ref))


def _combined(drafts: Iterable[EdgeDraft]) -> dict[EdgeKey, EdgeDraft]:
    combined: dict[EdgeKey, EdgeDraft] = {}
    for draft in drafts:
        if draft.src == draft.dst:  # a self-loop says nothing
            continue
        seen = combined.get(draft.key)
        if seen is None:
            combined[draft.key] = draft
        else:
            seen.weight = max(seen.weight, draft.weight)
            seen.evidence = union(seen.evidence, draft.evidence)
    return combined


def _contributed(session: Session, document_id: uuid.UUID, owns: Sequence[str]) -> list[Edge]:
    """Edges of the owned classes that this document backs (its nodes or its evidence)."""
    prefix = f"{document_id}#%"
    has_evidence = text(
        "exists (select 1 from unnest(edges.evidence) as ev where ev like :prefix)"
    ).bindparams(prefix=prefix)
    return list(
        session.exec(
            select(Edge).where(
                origin_in(owns),
                or_(col(Edge.src_id).like(prefix), col(Edge.dst_id).like(prefix), has_evidence),
            )
        ).all()
    )


def _on_document_node(edge: Edge, document_id: uuid.UUID) -> bool:
    """An endpoint is a passage of this document: the edge is wholly its own."""
    prefix = f"{document_id}#"
    ends = ((edge.src_kind, edge.src_id), (edge.dst_kind, edge.dst_id))
    return any(kind is EntityKind.NODE and ref.startswith(prefix) for kind, ref in ends)


def _foreign(evidence: Iterable[str], document_id: uuid.UUID) -> list[str]:
    return [e for e in evidence if not ((p := split_anchor(e)) and p[0] == document_id)]


# Qualified evidence anchor → the origin of the artifact that stands behind it, if any.
OwnerOf = Callable[[str], str | None]


def _owned_by(session: Session, origin: str, document_id: uuid.UUID) -> bool:
    """The origin names an artifact of this document."""
    artifact_id = origin_artifact_id(origin)
    artifact = session.get(Artifact, artifact_id) if artifact_id else None
    return artifact is not None and artifact.document_id == document_id


def _hand_over(session: Session, edge: Edge, document_id: uuid.UUID, owner_of: OwnerOf) -> None:
    """The withdrawing document owned this shared edge: give it to a remaining backer."""
    if not _owned_by(session, edge.origin, document_id):
        return
    for evidence in edge.evidence:
        if (origin := owner_of(evidence)) is not None:
            edge.origin = origin
            return


def reconcile(
    session: Session,
    document_id: uuid.UUID,
    desired: Iterable[EdgeDraft],
    *,
    owns: Sequence[str],
    takes_over: Sequence[str] = (),
    owner_of: OwnerOf = lambda _evidence: None,
) -> Reconciled:
    """Make `document_id`'s contribution to the `owns` class exactly `desired`.

    Rows of a `takes_over` class that collide with a desired key are adopted (a skill
    edge supersedes a diagram seed). Flushes; the caller commits.
    """
    report = Reconciled()
    wanted = _combined(desired)
    for key, draft in wanted.items():
        edge = find_edge(session, key)
        if edge is None:
            edge = draft.row()
            session.add(edge)
            report.created += 1
        elif _matches(edge.origin, owns) or _matches(edge.origin, takes_over):
            adopt = not _matches(edge.origin, owns)
            foreign = _foreign(edge.evidence, document_id)
            edge.evidence = union(foreign, draft.evidence)
            edge.weight = max(edge.weight, draft.weight) if foreign else draft.weight
            if adopt or not foreign or _owned_by(session, edge.origin, document_id):
                edge.origin = draft.origin
            if adopt and edge.status is EdgeStatus.PROPOSED:
                edge.status = draft.status
            session.add(edge)
            report.updated += 1
        else:
            report.kept += 1
            continue
        report.touch(edge)
    session.flush()

    for edge in _contributed(session, document_id, owns):
        if edge_key(edge) in wanted:
            continue
        report.touch(edge)
        remaining = _foreign(edge.evidence, document_id)
        if not remaining or _on_document_node(edge, document_id):
            session.delete(edge)
            report.removed += 1
            continue
        edge.evidence = remaining
        _hand_over(session, edge, document_id, owner_of)
        session.add(edge)
        report.updated += 1
    session.flush()
    return report

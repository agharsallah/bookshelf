"""A `concept_links` artifact → concepts and edges (§11), and its withdrawal.

One document contributes through at most one artifact at a time: its *effective*
`concept_links` — the latest approved version, else the latest draft (`needs_review` and
rejected rows never count). `sync_document` makes the graph match it; every trigger
(job done, approve, edit, reject) calls that, so the graph always reflects what the review
queue shows, and re-running any trigger is a no-op.

Applying an artifact:

* **Concepts** are upserted by name. A canonical that matches an existing canonical or
  alias (case-insensitively; merged concepts resolve to their survivor) reuses that row and
  its `kind`; the artifact's canonical and aliases are added as aliases. A blurb is written
  only where none exists, or where the current one came from this same document (never
  over a human's: `origin = human` concepts keep their blurb).
* **Edges** get `origin = skill:link-concepts@<v>#<artifact_id>` (`human:concept_links#…`
  for a human version). Node endpoints resolve to `<document_id>#<anchor>`; evidence
  anchors are qualified the same way (`app.graph.refs`). An endpoint or evidence anchor
  missing from the document is dropped and reported; an edge left without a valid endpoint
  or evidence is skipped. `same_as` lands `proposed`, everything else `accepted`; an
  existing edge keeps the status a human gave it.
* **Withdrawal** (`reconcile` against the new desired set) strips this document's evidence
  from edges it no longer asserts, deletes edges nothing else backs, and deletes concepts
  it left with no edge (diagram seeds do not count), unless merged or merged into.
"""

import logging
import uuid
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import or_, text
from sqlmodel import Session, col, select

from app.graph import names
from app.graph.edges import (
    LINK_ORIGINS,
    SEED_ORIGINS,
    EdgeDraft,
    OwnerOf,
    Reconciled,
    artifact_origin,
    reconcile,
)
from app.graph.refs import Ref, split_anchor
from app.models import Artifact, Concept, Edge, node_ref
from app.models.enums import (
    ArtifactType,
    ConceptKind,
    EdgeStatus,
    EntityKind,
    Origin,
    Relation,
    Review,
)
from app.pipeline.artifacts import document_anchors
from app.pipeline.bodies import plain_text

logger = logging.getLogger(__name__)

_EFFECTIVE = (Review.APPROVED, Review.DRAFT)


@dataclass(slots=True)
class Applied:
    """What one sync changed. `created` feeds the dedup pass."""

    artifact_id: uuid.UUID | None
    created: list[uuid.UUID] = field(default_factory=list)
    removed: list[uuid.UUID] = field(default_factory=list)
    edges: Reconciled = field(default_factory=Reconciled)
    problems: list[str] = field(default_factory=list)


def effective_artifact(
    session: Session, document_id: uuid.UUID, *, exclude: uuid.UUID | None = None
) -> Artifact | None:
    query = select(Artifact).where(
        Artifact.document_id == document_id,
        Artifact.type == ArtifactType.CONCEPT_LINKS,
        col(Artifact.review).in_(_EFFECTIVE),
    )
    if exclude is not None:
        query = query.where(Artifact.id != exclude)
    rows = session.exec(query.order_by(col(Artifact.version))).all()
    approved = [row for row in rows if row.review is Review.APPROVED]
    ranked = approved or list(rows)
    return ranked[-1] if ranked else None


def _owner_of(session: Session) -> OwnerOf:
    def owner(evidence: str) -> str | None:
        parts = split_anchor(evidence)
        artifact = effective_artifact(session, parts[0]) if parts is not None else None
        return artifact_origin(artifact) if artifact is not None else None

    return owner


# --- Concepts ------------------------------------------------------------------------


def _from_document(cites: Iterable[str], document_id: uuid.UUID) -> bool:
    parsed = [split_anchor(c) for c in cites]
    return bool(parsed) and all(p is not None and p[0] == document_id for p in parsed)


class _Builder:
    """Resolves one artifact body against the database, collecting problems as it goes."""

    def __init__(self, session: Session, artifact: Artifact) -> None:
        self.session = session
        self.document_id = artifact.document_id
        self.origin = artifact_origin(artifact)
        self.anchors = document_anchors(session, artifact.document_id)
        self.body = artifact.body
        self.by_name: dict[str, Concept] = {}
        self.result = Applied(artifact_id=artifact.id)

    def _qualified(self, anchors: Any, where: str) -> list[str]:
        out: list[str] = []
        for anchor in anchors if isinstance(anchors, list) else []:
            if isinstance(anchor, str) and anchor in self.anchors:
                out.append(node_ref(self.document_id, anchor))
            else:
                self.result.problems.append(f"{where}: unknown anchor {anchor!r}")
        return out

    def concepts(self) -> None:
        items = [
            c
            for c in self.body.get("concepts", [])
            if isinstance(c, dict) and isinstance(c.get("canonical"), str) and c["canonical"]
        ]
        refs = [
            ep["ref"]
            for e in self.body.get("edges", [])
            if isinstance(e, dict)
            for ep in (e.get("src"), e.get("dst"))
            if isinstance(ep, dict)
            and ep.get("kind") == "concept"
            and isinstance(ep.get("ref"), str)
        ]
        self.by_name = names.lookup(self.session, [c["canonical"] for c in items] + refs)
        for item in items:
            self._upsert(item)
        self.session.flush()

    def _upsert(self, item: dict[str, Any]) -> None:
        canonical = " ".join(item["canonical"].split())
        key = names.normalize(canonical)
        aliases = [a for a in item.get("aliases", []) if isinstance(a, str)]
        concept = self.by_name.get(key)
        if concept is None:
            try:
                kind = ConceptKind(item.get("kind", "concept"))
            except ValueError:
                kind = ConceptKind.CONCEPT
            concept = Concept(canonical=canonical, kind=kind)
            self.session.add(concept)
            self.session.flush()
            self.result.created.append(concept.id)
        concept.aliases = names.merged_aliases(
            concept.aliases, [canonical, *aliases], concept.canonical
        )
        blurb = plain_text(item.get("blurb", [])).strip()
        cites = self._qualified(
            sorted(
                {
                    c
                    for s in item.get("blurb", [])
                    if isinstance(s, dict)
                    for c in s.get("cites", [])
                }
            ),
            f"blurb of {canonical!r}",
        )
        mine = concept.origin is Origin.SKILL and _from_document(
            concept.blurb_cites, self.document_id
        )
        if blurb and (not concept.blurb or mine):
            concept.blurb, concept.blurb_cites = blurb, cites
        self.session.add(concept)
        for name in [canonical, *aliases]:
            self.by_name.setdefault(names.normalize(name), concept)

    # --- Edges ---------------------------------------------------------------------

    def _endpoint(self, value: Any, where: str) -> Ref | None:
        kind = value.get("kind") if isinstance(value, dict) else None
        ref = value.get("ref") if isinstance(value, dict) else None
        if kind == "concept" and isinstance(ref, str):
            concept = self.by_name.get(names.normalize(ref))
            if concept is not None:
                return Ref.concept(concept.id)
            self.result.problems.append(f"{where}: unknown concept {ref!r}")
        elif kind == "node" and isinstance(ref, str) and ref in self.anchors:
            return Ref.node(self.document_id, ref)
        else:
            self.result.problems.append(f"{where}: bad endpoint {value!r}")
        return None

    def edges(self) -> list[EdgeDraft]:
        drafts: list[EdgeDraft] = []
        for index, item in enumerate(self.body.get("edges", [])):
            where = f"edges[{index}]"
            if not isinstance(item, dict):
                continue
            src, dst = (
                self._endpoint(item.get("src"), where),
                self._endpoint(item.get("dst"), where),
            )
            evidence = self._qualified(item.get("evidence"), where)
            try:
                relation = Relation(str(item.get("relation")))
            except ValueError:
                self.result.problems.append(f"{where}: unknown relation {item.get('relation')!r}")
                continue
            if src is None or dst is None or not evidence:
                continue
            weight = item.get("weight", 1.0)
            drafts.append(
                EdgeDraft(
                    src=src,
                    dst=dst,
                    relation=relation,
                    weight=min(max(float(weight), 0.0), 1.0)
                    if isinstance(weight, int | float)
                    else 1.0,
                    evidence=evidence,
                    origin=self.origin,
                    status=EdgeStatus.PROPOSED
                    if relation is Relation.SAME_AS
                    else EdgeStatus.ACCEPTED,
                )
            )
        return drafts

    def referenced(self) -> set[uuid.UUID]:
        return {c.id for c in self.by_name.values()}


def _concept_edges(session: Session, concept_id: uuid.UUID) -> list[Edge]:
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


def _blurbed_by(session: Session, document_id: uuid.UUID) -> set[uuid.UUID]:
    hit = text(
        "exists (select 1 from unnest(concepts.blurb_cites) as c where c like :prefix)"
    ).bindparams(prefix=f"{document_id}#%")
    return set(session.exec(select(Concept.id).where(hit)).all())


def _prune(
    session: Session, candidates: set[uuid.UUID], keep: set[uuid.UUID], document_id: uuid.UUID
) -> list[uuid.UUID]:
    """Delete candidates left without a non-seed edge; clear blurbs this document wrote.

    Concepts a human created or edited (`origin = human`) are never touched."""
    removed: list[uuid.UUID] = []
    for concept_id in sorted(candidates - keep):
        concept = session.get(Concept, concept_id)
        if concept is None or concept.origin is Origin.HUMAN:
            continue
        edges = _concept_edges(session, concept_id)
        seeds_only = all(
            any(e.origin.startswith(p.rstrip("%")) for p in SEED_ORIGINS) for e in edges
        )
        children = session.exec(select(Concept.id).where(Concept.merged_into == concept_id)).first()
        if seeds_only and concept.merged_into is None and children is None:
            for edge in edges:
                session.delete(edge)
            session.delete(concept)
            removed.append(concept_id)
        elif _from_document(concept.blurb_cites, document_id):
            concept.blurb, concept.blurb_cites = None, []
            session.add(concept)
    session.flush()
    return removed


# --- Entry points ------------------------------------------------------------------------


def _sync(session: Session, document_id: uuid.UUID, artifact: Artifact | None) -> Applied:
    candidates = _blurbed_by(session, document_id)
    if artifact is None:
        result, drafts, keep = Applied(artifact_id=None), [], set[uuid.UUID]()
    else:
        builder = _Builder(session, artifact)
        builder.concepts()
        drafts, keep, result = builder.edges(), builder.referenced(), builder.result
    result.edges = reconcile(
        session,
        document_id,
        drafts,
        owns=LINK_ORIGINS,
        takes_over=SEED_ORIGINS,
        owner_of=_owner_of(session),
    )
    result.removed = _prune(session, candidates | result.edges.concepts, keep, document_id)
    session.commit()
    if result.problems:
        logger.warning(
            "Concept links applied with problems",
            extra={"document_id": str(document_id), "problems": result.problems[:20]},
        )
    return result


def apply(session: Session, artifact: Artifact) -> Applied:
    """Make `artifact` the document's contribution to the graph. Idempotent. Commits."""
    if artifact.type is not ArtifactType.CONCEPT_LINKS:
        raise ValueError(f"cannot apply a {artifact.type.value} artifact to the graph")
    return _sync(session, artifact.document_id, artifact)


def clear(session: Session, document_id: uuid.UUID) -> Applied:
    """Withdraw everything the document contributed through `concept_links`. Commits."""
    return _sync(session, document_id, None)


def unapply(session: Session, artifact: Artifact) -> Applied:
    """Withdraw `artifact`: the document falls back to its next effective version, if any."""
    fallback = effective_artifact(session, artifact.document_id, exclude=artifact.id)
    if fallback is not None:
        return apply(session, fallback)
    return clear(session, artifact.document_id)


def sync_document(session: Session, document_id: uuid.UUID) -> Applied:
    """Make the graph reflect the document's effective `concept_links` (or none)."""
    artifact = effective_artifact(session, document_id)
    return apply(session, artifact) if artifact is not None else clear(session, document_id)

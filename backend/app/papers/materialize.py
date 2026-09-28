"""Materializers: project an approved paper artifact into its table (docs/PAPERS.md P5).

Skills write artifacts; the review queue stays in charge; tables that other features query
(claims, reference intents) are **derived** from the effective artifact and rebuildable from
it at any time (D1). A materializer is a function

    (session, document) → follow-up JobSpecs

registered in `MATERIALIZERS` by artifact type. The paper profile runs it as an orchestrator
effect whenever a verdict on that type changes the effective version: approve, edit (a new
approved version), reject, reopen. Re-running it is a no-op, so every trigger may call it.

**Effective version**: the latest *approved* version of the type for the document, ignoring
drafts (a claim the reader never approved is not on the shelf). None left (the only
approved version was reopened or rejected): the table's rows for the document go.

Citation intents (`citation_intents` → `paper_references.intent`): `papers.intents`.

Claims (`claim_set` → `claims`):

* A row per claim, id `papers.claims.claim_id(document, text)`: a claim a new version keeps
  keeps its id, and with it its Qdrant point and every claim ↔ claim edge; its key, kind,
  strength, evidence and unit follow the new version. Rows the effective version no longer
  has are deleted, with the claim ↔ claim edges on them (the relations of a withdrawn claim
  have nothing left to point at).
* Follow-ups: claims came → `relate_claims` for the document (new cross-paper pairs); the
  set changed and the paper is already indexed → `embed`, which syncs the claim points.
"""

import logging
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field

from sqlalchemy import delete, or_
from sqlmodel import Session, col, select

from app.jobs.queue import JobSpec
from app.models import Artifact, Claim, Document, Edge
from app.models.enums import (
    ArtifactType,
    ClaimKind,
    ClaimStrength,
    DocumentStatus,
    EntityKind,
    JobKind,
    Review,
)
from app.papers.claim_pairs import relate_spec
from app.papers.claims import claim_id, claim_unit
from app.papers.intents import materialize_intents
from app.papers.units import units
from app.pipeline.orchestrator import _RANK, PRIORITY  # status order, as guide_approved reads it
from app.pipeline.tree import Tree

logger = logging.getLogger(__name__)

Materializer = Callable[[Session, Document], list[JobSpec]]


def effective(session: Session, document_id: uuid.UUID, kind: ArtifactType) -> Artifact | None:
    """The latest approved artifact of `kind` for the document (document scope), or None."""
    return session.exec(
        select(Artifact)
        .where(
            Artifact.document_id == document_id,
            Artifact.type == kind,
            col(Artifact.anchor).is_(None),
            Artifact.review == Review.APPROVED,
        )
        .order_by(col(Artifact.version).desc())
    ).first()


def _is_indexed(document: Document) -> bool:
    return _RANK.get(document.status, -1) >= _RANK[DocumentStatus.INDEXED]


# --- Claims ------------------------------------------------------------------------------


@dataclass(slots=True)
class ClaimsSynced:
    """What one claims projection changed (ids as strings, sorted)."""

    artifact_id: uuid.UUID | None
    created: list[str] = field(default_factory=list)
    updated: list[str] = field(default_factory=list)
    removed: list[str] = field(default_factory=list)
    edges_removed: int = 0

    @property
    def changed(self) -> bool:
        return bool(self.created or self.updated or self.removed)


def _desired(document: Document, artifact: Artifact, tree: Tree) -> dict[uuid.UUID, Claim]:
    """The rows the artifact asks for, by id. A human edit may repeat a claim's text or its
    key (`unique (artifact_id, key)`); the first one wins (the gate refuses both from a
    skill)."""
    unit_anchors = {u.anchor for u in units(tree)}
    rows: dict[uuid.UUID, Claim] = {}
    keys: set[str] = set()
    for item in artifact.body.get("claims", []):
        cites = [c for c in item.get("cites", []) if isinstance(c, str)]
        if not cites or not item.get("text"):
            continue
        cid = claim_id(document.id, item["text"])
        if cid in rows or str(item["key"]) in keys:
            continue
        keys.add(str(item["key"]))
        rows.setdefault(
            cid,
            Claim(
                id=cid,
                document_id=document.id,
                artifact_id=artifact.id,
                key=str(item["key"]),
                text=str(item["text"]),
                kind=ClaimKind(item["kind"]),
                strength=ClaimStrength(item["strength"]),
                evidence=cites,
                unit=claim_unit(cites, unit_anchors),
            ),
        )
    return rows


_FIELDS = ("artifact_id", "key", "text", "kind", "strength", "evidence", "unit")


def sync_claims(session: Session, document: Document) -> ClaimsSynced:
    """Make `claims` hold exactly the effective claim_set's claims. Commits."""
    artifact = effective(session, document.id, ArtifactType.CLAIM_SET)
    wanted = _desired(document, artifact, Tree.load(session, document)) if artifact else {}
    current = {
        c.id: c for c in session.exec(select(Claim).where(Claim.document_id == document.id)).all()
    }
    synced = ClaimsSynced(artifact_id=artifact.id if artifact else None)
    gone = [cid for cid in current if cid not in wanted]
    if gone:
        synced.edges_removed = drop_claim_edges(session, gone)
        session.execute(delete(Claim).where(col(Claim.id).in_(gone)))
        session.flush()
    for cid, row in wanted.items():
        stored = current.get(cid)
        if stored is None:
            session.add(row)
            synced.created.append(str(cid))
        elif any(getattr(stored, f) != getattr(row, f) for f in _FIELDS):
            for name in _FIELDS:
                setattr(stored, name, getattr(row, name))
            session.add(stored)
            synced.updated.append(str(cid))
    session.commit()
    synced.removed = sorted(str(c) for c in gone)
    synced.created.sort()
    synced.updated.sort()
    if synced.changed:
        logger.info(
            "Claims materialized",
            extra={
                "document_id": str(document.id),
                "artifact_id": str(synced.artifact_id) if synced.artifact_id else None,
                "claims_created": len(synced.created),
                "claims_updated": len(synced.updated),
                "claims_removed": len(synced.removed),
            },
        )
    return synced


def drop_document_claim_edges(session: Session, document_id: uuid.UUID) -> int:
    """Withdraw every edge touching the document's claims, before it is deleted: edges
    have no foreign key, so the claims' cascade would leave them behind."""
    ids = list(session.exec(select(Claim.id).where(Claim.document_id == document_id)).all())
    return drop_claim_edges(session, ids) if ids else 0


def drop_claim_edges(session: Session, claim_ids: list[uuid.UUID]) -> int:
    ids = [str(c) for c in claim_ids]
    claim = EntityKind.CLAIM
    result = session.execute(
        delete(Edge).where(
            or_(
                (col(Edge.src_kind) == claim) & col(Edge.src_id).in_(ids),
                (col(Edge.dst_kind) == claim) & col(Edge.dst_id).in_(ids),
            )
        )
    )
    return int(getattr(result, "rowcount", 0) or 0)


def materialize_claims(session: Session, document: Document) -> list[JobSpec]:
    """`sync_claims`, then the follow-up jobs it calls for (module docstring)."""
    synced = sync_claims(session, document)
    follow: list[JobSpec] = []
    if synced.created:
        follow.append(relate_spec(document.id, synced.created))
    if synced.changed and _is_indexed(document):
        follow.append(
            JobSpec(kind=JobKind.EMBED, document_id=document.id, priority=PRIORITY[JobKind.EMBED])
        )
    return follow


# Artifact type → its materializer. The paper profile hooks every entry into its approval,
# rejection and reopen tables. Another projection (citation intents) adds one line here.
MATERIALIZERS: dict[ArtifactType, Materializer] = {
    ArtifactType.CLAIM_SET: materialize_claims,
    ArtifactType.CITATION_INTENTS: materialize_intents,  # app.papers.intents
}


def materialize(session: Session, document: Document, kind: ArtifactType) -> list[JobSpec]:
    """Run the materializer of `kind` (none: nothing to do)."""
    project = MATERIALIZERS.get(kind)
    return project(session, document) if project is not None else []

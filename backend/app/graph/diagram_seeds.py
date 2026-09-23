"""Diagrams as seed edges (§8: "diagram nodes/edges → seed edges for link-concepts").

A `describe-figure` output for a diagram carries `{type: diagram, nodes, edges}` blocks: a
small concept graph the author drew. This pass turns it into *candidate* edges, and is
deliberately conservative:

* only figure descriptions the pipeline would consume (latest approved, else a draft that
  is not low-confidence; never `needs_review` or rejected);
* a diagram node counts only when its label *is* a known concept — the canonical name or
  an alias after normalisation, or its simple plural/singular — never a fuzzy match;
* `figure —mentions→ concept` (weight 0.4, accepted: the label is literally in the figure)
  and, for an arrow between two matched labels, `concept —supports→ concept` (weight 0.4,
  **proposed**: an arrow's meaning is the text's to explain, so a human confirms it);
* evidence is the figure anchor, qualified `<document_id>#<anchor>`.

Seeds are reconciled per document like skill edges, so re-running is a no-op and a figure
that loses its diagram loses its seeds. A skill edge with the same key adopts a seed.
"""

import uuid
from collections.abc import Iterable
from typing import Any

from sqlmodel import Session

from app.graph import names
from app.graph.edges import SEED_ORIGINS, EdgeDraft, Reconciled, reconcile
from app.graph.refs import Ref, split_anchor
from app.models import Artifact, Concept, node_ref
from app.models.enums import ArtifactType, EdgeStatus, Relation, Review
from app.pipeline import artifacts
from app.pipeline.bodies import iter_objects

SEED_VERSION = "1"
SEED_WEIGHT = 0.4
_CONSUMED = (Review.APPROVED, Review.DRAFT)


def seed_origin(artifact: Artifact) -> str:
    return f"seed:diagram@{SEED_VERSION}#{artifact.id}"


def figure_artifacts(session: Session, document_id: uuid.UUID) -> dict[str, Artifact]:
    """Figure anchor → the description the pipeline reads for it."""
    kind = ArtifactType.FIGURE_DESCRIPTION
    found = artifacts.preferred(session, document_id, [kind])
    return {
        anchor: artifact
        for (_, anchor), artifact in found.items()
        if anchor is not None and artifact.review in _CONSUMED and artifacts.is_consumable(artifact)
    }


def diagrams(body: dict[str, Any]) -> list[dict[str, Any]]:
    return [obj for obj in iter_objects(body) if obj.get("type") == "diagram"]


def _variants(label: str) -> list[str]:
    key = names.normalize(label)
    out = [key]
    if len(key) > 3 and key.endswith("s") and not key.endswith("ss"):
        out.append(key[:-1])
    else:
        out.append(f"{key}s")
    return out


def _matcher(session: Session, labels: Iterable[str]) -> dict[str, Concept]:
    """Label → concept, exact (normalised) or simple plural/singular only."""
    labels = list(labels)
    found = names.lookup(session, [v for label in labels for v in _variants(label)])
    matched: dict[str, Concept] = {}
    for label in labels:
        concept = next((found[v] for v in _variants(label) if v in found), None)
        if concept is not None:
            matched[label] = concept
    return matched


def _drafts(
    session: Session, document_id: uuid.UUID, anchor: str, artifact: Artifact
) -> list[EdgeDraft]:
    figure = Ref.node(document_id, anchor)
    evidence = [node_ref(document_id, anchor)]
    origin = seed_origin(artifact)
    drafts: list[EdgeDraft] = []
    for diagram in diagrams(artifact.body):
        nodes = {
            n["id"]: n["label"]
            for n in diagram.get("nodes", [])
            if isinstance(n, dict)
            and isinstance(n.get("id"), str)
            and isinstance(n.get("label"), str)
        }
        by_label = _matcher(session, nodes.values())
        by_id = {node_id: by_label[label] for node_id, label in nodes.items() if label in by_label}
        for concept in {c.id: c for c in by_id.values()}.values():
            drafts.append(
                EdgeDraft(figure, Ref.concept(concept.id), Relation.MENTIONS, SEED_WEIGHT,
                          list(evidence), origin, EdgeStatus.ACCEPTED)
            )  # fmt: skip
        for arrow in diagram.get("edges", []):
            src = by_id.get(arrow.get("from")) if isinstance(arrow, dict) else None
            dst = by_id.get(arrow.get("to")) if isinstance(arrow, dict) else None
            if src is not None and dst is not None and src.id != dst.id:
                drafts.append(
                    EdgeDraft(Ref.concept(src.id), Ref.concept(dst.id), Relation.SUPPORTS,
                              SEED_WEIGHT, list(evidence), origin, EdgeStatus.PROPOSED)
                )  # fmt: skip
    return drafts


def seed_document(session: Session, document_id: uuid.UUID) -> Reconciled:
    """Reconcile the document's diagram seeds with its current figures and concepts. Commits."""
    valid = artifacts.document_anchors(session, document_id)
    drafts = [
        draft
        for anchor, artifact in figure_artifacts(session, document_id).items()
        if anchor in valid
        for draft in _drafts(session, document_id, anchor, artifact)
    ]

    def owner(evidence: str) -> str | None:
        parts = split_anchor(evidence)
        if parts is None:
            return None
        figure = figure_artifacts(session, parts[0]).get(parts[1])
        return seed_origin(figure) if figure is not None else None

    report = reconcile(session, document_id, drafts, owns=SEED_ORIGINS, owner_of=owner)
    session.commit()
    return report

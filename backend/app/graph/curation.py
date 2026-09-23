"""Human curation of the graph: concepts and edges written or judged by hand (§11).

Everything here is `origin = human`, concepts included: a concept a person created or
edited is never garbage-collected or re-blurbed by a skill re-sync. Names stay unique
across canonicals *and* aliases, so a human cannot create the duplicate the dedup pass
exists to catch; a rename keeps the old canonical as an alias, so skill output that still
uses it resolves to the same concept.
Deleting a machine edge rejects it instead: a re-applied artifact would otherwise put it
straight back.
"""

import uuid
from collections.abc import Sequence

from sqlmodel import Session

from app.core.errors import ConflictError
from app.graph import names
from app.graph.edges import HUMAN, EdgeDraft, find_edge
from app.graph.evidence import passages
from app.graph.refs import RefError, resolve_ref
from app.models import Concept, Edge
from app.models.enums import ConceptKind, EdgeStatus, Origin, Relation
from app.services.errors import InvalidInputError


def check_evidence(session: Session, refs: Sequence[str], field: str) -> list[str]:
    """Every entry must be `<document_id>#<anchor>` naming an existing passage."""
    found = passages(session, refs)
    bad = [r for r in refs if r not in found or not found[r].exists]
    if bad:
        raise InvalidInputError(f"Unknown passages: {', '.join(bad[:5])}", field=field)
    return list(dict.fromkeys(refs))


def _claim_names(
    session: Session, wanted: Sequence[str], *, owner: uuid.UUID | None, field: str
) -> None:
    taken = {
        key: concept
        for key, concept in names.lookup(session, wanted).items()
        if concept.id != owner
    }
    if taken:
        key, concept = next(iter(taken.items()))
        raise ConflictError(
            f"{key!r} already names concept {concept.canonical!r} ({concept.id}).",
            [{"field": field, "concept_id": str(concept.id)}],
        )


def create_concept(
    session: Session,
    *,
    canonical: str,
    kind: ConceptKind,
    aliases: Sequence[str] = (),
    blurb: str | None = None,
    blurb_cites: Sequence[str] = (),
) -> Concept:
    canonical = " ".join(canonical.split())
    _claim_names(session, [canonical, *aliases], owner=None, field="canonical")
    concept = Concept(
        canonical=canonical,
        kind=kind,
        aliases=names.merged_aliases([], aliases, canonical),
        blurb=blurb,
        blurb_cites=check_evidence(session, blurb_cites, "blurb_cites"),
        origin=Origin.HUMAN,
    )
    session.add(concept)
    session.commit()
    session.refresh(concept)
    return concept


def update_concept(
    session: Session,
    concept: Concept,
    *,
    canonical: str | None = None,
    kind: ConceptKind | None = None,
    aliases: Sequence[str] | None = None,
    blurb: str | None = None,
    blurb_cites: Sequence[str] | None = None,
    clear_blurb: bool = False,
) -> Concept:
    if concept.merged_into is not None:
        raise ConflictError(f"{concept.canonical!r} is merged; edit {concept.merged_into}.")
    new_aliases = list(concept.aliases) if aliases is None else list(aliases)
    if canonical is not None and names.normalize(canonical) != names.normalize(concept.canonical):
        canonical = " ".join(canonical.split())
        _claim_names(session, [canonical], owner=concept.id, field="canonical")
        new_aliases.append(concept.canonical)  # old name keeps resolving here
        concept.canonical = canonical
    elif canonical is not None:
        concept.canonical = " ".join(canonical.split())  # a case or spacing fix
    if aliases is not None:
        _claim_names(session, list(aliases), owner=concept.id, field="aliases")
    concept.aliases = names.merged_aliases([], new_aliases, concept.canonical)
    if kind is not None:
        concept.kind = kind
    if clear_blurb:
        concept.blurb, concept.blurb_cites = None, []
    if blurb is not None:
        concept.blurb = blurb
    if blurb_cites is not None:
        concept.blurb_cites = check_evidence(session, blurb_cites, "blurb_cites")
    concept.origin = Origin.HUMAN  # curated now: automation never deletes or re-blurbs it
    session.add(concept)
    session.commit()
    session.refresh(concept)
    return concept


def create_edge(
    session: Session,
    *,
    src: str,
    dst: str,
    relation: Relation,
    weight: float,
    evidence: Sequence[str],
) -> Edge:
    """A hand-drawn edge between any two existing endpoints, backed by real passages."""
    try:
        src_ref, dst_ref = resolve_ref(session, src), resolve_ref(session, dst)
    except RefError as exc:
        raise InvalidInputError(str(exc), field="src/dst") from exc
    if src_ref == dst_ref:
        raise InvalidInputError("An edge needs two different endpoints.", field="dst")
    draft = EdgeDraft(
        src=src_ref,
        dst=dst_ref,
        relation=relation,
        weight=weight,
        evidence=check_evidence(session, evidence, "evidence"),
        origin=HUMAN,
    )
    existing = find_edge(session, draft.key)
    if existing is not None:
        raise ConflictError(
            f"Edge {existing.id} already links these with {relation.value}.",
            [{"field": "relation", "edge_id": str(existing.id)}],
        )
    edge = draft.row()
    session.add(edge)
    session.commit()
    session.refresh(edge)
    return edge


def set_edge_status(session: Session, edge: Edge, status: EdgeStatus) -> Edge:
    edge.status = status
    session.add(edge)
    session.commit()
    session.refresh(edge)
    return edge


def delete_edge(session: Session, edge: Edge) -> bool:
    """Hand-drawn edges are deleted; machine edges are rejected. True when deleted."""
    if edge.origin == HUMAN:
        session.delete(edge)
        session.commit()
        return True
    set_edge_status(session, edge, EdgeStatus.REJECTED)
    return False

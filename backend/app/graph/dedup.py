"""Concept deduplication (§11): candidates by embedding similarity, confirmed by a model.

    new concepts ─ embed canonical + blurb ─ cosine ≥ threshold against every live concept
      → skip pairs that already carry a `same_as` edge (either direction, any status)
      → `confirm-merge` skill (tier `reason`) through the `ModelRunner`
      → same: `same_as` edge, status **proposed**   (review queue, a human merges)
        not:  `same_as` edge, status rejected       (remembered, never asked twice)

Nothing here merges. The edge's `weight` is the similarity; its evidence is both blurbs'
cites, so a reviewer can read what each book means. The verdict (similarity, confidence,
rationale, suggested survivor) is kept in the edge's `meta` for the review queue.
"""

import math
import uuid
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Protocol

from sqlmodel import Session, col, select

from app.db.session import release
from app.graph import names
from app.graph.edges import DEDUP_ORIGIN_PREFIX, EdgeDraft, find_edge, union
from app.graph.refs import Ref, split_anchor
from app.models import Concept, Document, Edge
from app.models.enums import EdgeStatus, EntityKind, Relation
from app.pipeline.gates import output_problems
from app.pipeline.runner import ModelRunner, OutputError, run_structured
from app.pipeline.skills import Skill, load_skill, render_prompt

SKILL_NAME = "confirm-merge"


class DenseEmbedder(Protocol):
    """The slice of `app.retrieval.embedding.Embedder` dedup needs."""

    def dense(self, texts: Sequence[str]) -> list[list[float]]: ...


@dataclass(frozen=True, slots=True)
class Candidate:
    a: Concept  # the newer concept
    b: Concept
    similarity: float


@dataclass(frozen=True, slots=True)
class Verdict:
    a: str
    b: str
    similarity: float
    same: bool | None  # None: the model's reply was unusable
    confidence: str | None
    rationale: str | None
    survivor: str | None  # concept id the model suggests keeping
    edge_id: str | None

    def as_json(self) -> dict[str, Any]:
        return asdict(self)


def concept_text(concept: Concept) -> str:
    return f"{concept.canonical}. {concept.blurb}" if concept.blurb else concept.canonical


def cosine(u: Sequence[float], v: Sequence[float]) -> float:
    dot = sum(x * y for x, y in zip(u, v, strict=True))
    norm = math.sqrt(sum(x * x for x in u)) * math.sqrt(sum(y * y for y in v))
    return dot / norm if norm else 0.0


def _judged_pairs(session: Session) -> set[frozenset[str]]:
    rows = session.exec(
        select(Edge.src_id, Edge.dst_id).where(
            Edge.relation == Relation.SAME_AS,
            Edge.src_kind == EntityKind.CONCEPT,
            Edge.dst_kind == EntityKind.CONCEPT,
        )
    ).all()
    return {frozenset(pair) for pair in rows}


def candidates(
    session: Session,
    concept_ids: Sequence[uuid.UUID],
    *,
    embedder: DenseEmbedder,
    threshold: float,
    limit: int,
) -> list[Candidate]:
    """Unjudged pairs (new concept, any live concept) above `threshold`, most similar first."""
    pool = names.live_concepts(session)
    wanted = set(concept_ids)
    fresh = [c for c in pool if c.id in wanted]
    if not fresh or len(pool) < 2:
        return []
    ids, texts = [c.id for c in pool], [concept_text(c) for c in pool]
    release(session)  # no transaction open while embedding
    vectors = dict(zip(ids, embedder.dense(texts), strict=True))
    judged = _judged_pairs(session)
    found: dict[frozenset[str], Candidate] = {}
    for a in fresh:
        for b in pool:
            pair = frozenset((str(a.id), str(b.id)))
            if a.id == b.id or pair in judged or pair in found:
                continue
            similarity = cosine(vectors[a.id], vectors[b.id])
            if similarity >= threshold:
                found[pair] = Candidate(a=a, b=b, similarity=similarity)
    return sorted(found.values(), key=lambda c: -c.similarity)[:limit]


def _side(session: Session, concept: Concept) -> dict[str, Any]:
    doc_ids = {p[0] for c in concept.blurb_cites if (p := split_anchor(c)) is not None}
    titles = (
        session.exec(select(Document.title).where(col(Document.id).in_(doc_ids))).all()
        if doc_ids
        else []
    )
    return {
        "canonical": concept.canonical,
        "aliases": list(concept.aliases),
        "kind": concept.kind.value,
        "blurb": concept.blurb,
        "documents": sorted(titles),
    }


def load_confirm_skill(skills_dir: Path) -> Skill:
    return load_skill(skills_dir / SKILL_NAME)


def confirm(
    session: Session, candidate: Candidate, *, runner: ModelRunner, skill: Skill
) -> Verdict:
    """Ask the model; store the verdict as a `same_as` edge (proposed or rejected). Commits."""
    pair = {
        "similarity": round(candidate.similarity, 3),
        "a": _side(session, candidate.a),
        "b": _side(session, candidate.b),
    }
    prompt = render_prompt(skill.prompt, {"pair": pair})
    a_id, b_id = str(candidate.a.id), str(candidate.b.id)
    release(session)  # no transaction open through the CLI run(s)
    try:
        run = run_structured(
            runner,
            prompt,
            tier=skill.meta.tier,
            validate=lambda output: output_problems(skill.schema, output, ()),
        )
    except OutputError:
        return Verdict(a_id, b_id, candidate.similarity, None, None, None, None, None)
    output = run.output
    same = bool(output["same"])
    draft = EdgeDraft(
        src=Ref.concept(candidate.a.id),
        dst=Ref.concept(candidate.b.id),
        relation=Relation.SAME_AS,
        weight=round(min(max(candidate.similarity, 0.0), 1.0), 3),
        evidence=union(candidate.a.blurb_cites, candidate.b.blurb_cites),
        origin=f"{DEDUP_ORIGIN_PREFIX}{skill.version}",
        status=EdgeStatus.PROPOSED if same else EdgeStatus.REJECTED,
        meta={
            "similarity": round(candidate.similarity, 4),
            "confidence": str(output["confidence"]),
            "rationale": str(output["rationale"]),
            "survivor": a_id if output["survivor"] == "a" else b_id,
        },
    )
    edge = find_edge(session, draft.key)
    if edge is None:
        edge = draft.row()
        session.add(edge)
        session.commit()
        session.refresh(edge)
    return Verdict(
        a=a_id,
        b=b_id,
        similarity=candidate.similarity,
        same=same,
        confidence=str(output["confidence"]),
        rationale=str(output["rationale"]),
        survivor=a_id if output["survivor"] == "a" else b_id,
        edge_id=str(edge.id),
    )


def run_dedup(
    session: Session,
    concept_ids: Sequence[uuid.UUID],
    *,
    runner: ModelRunner,
    embedder: DenseEmbedder,
    skills_dir: Path,
    threshold: float,
    limit: int,
) -> list[Verdict]:
    """Propose merges for `concept_ids`. Never merges. Commits per verdict, so a retried
    job never asks about a pair twice."""
    found = candidates(session, concept_ids, embedder=embedder, threshold=threshold, limit=limit)
    if not found:
        return []
    skill = load_confirm_skill(skills_dir)
    return [confirm(session, c, runner=runner, skill=skill) for c in found]

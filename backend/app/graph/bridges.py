"""Bridges: how an idea in one book bears on an idea in another (§11), judged by a model.

`concept_links` relates concepts within the book it reads; nothing relates them across
books. This pass nominates cross-book pairs and asks the `relate-concepts` skill:

    concepts in no common book ─ embed name + blurb ─ cosine in [threshold, dedup threshold)
      → skip pairs that already carry any concept↔concept edge (any relation, any status)
      → each side's own passages (the evidence of its edges, strongest first), labelled
        A1, A2… and B1, B2…, so the model cites passages rather than recalling the books
      → `relate-concepts` (tier `reason`) through the `ModelRunner`
      → supports | contradicts | extends | example_of: an edge, status **proposed**,
        evidence the cited passages (at least one from each book), weight by confidence
        none: a **rejected** edge, so the pair is never asked about again

Nothing here is accepted automatically: a human accepts or rejects each bridge on the map.
Above the dedup threshold a pair is a merge question, not a relation, and is left to
`dedup`. Each verdict commits, so a retried job never asks about a pair twice.
"""

import uuid
from collections import defaultdict
from collections.abc import Callable, Sequence
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from sqlalchemy import tuple_
from sqlmodel import Session, col, select

from app.db.session import release
from app.graph import names
from app.graph.dedup import DenseEmbedder, concept_text, cosine
from app.graph.edges import EdgeDraft, find_edge
from app.graph.evidence import clip
from app.graph.refs import Ref, split_anchor
from app.models import Concept, Document, Edge, Node, node_ref
from app.models.enums import EdgeStatus, EntityKind, Relation
from app.pipeline.gates import schema_errors
from app.pipeline.runner import ModelRunner, OutputError, run_structured
from app.pipeline.skills import Skill, load_skill, render_prompt

SKILL_NAME = "relate-concepts"
PASSAGES_PER_SIDE = 3
PASSAGE_CHARS = 700
CONFIDENCE_WEIGHT = {"high": 0.8, "medium": 0.6, "low": 0.4}
_RELATIONS = {
    "supports": Relation.SUPPORTS,
    "contradicts": Relation.CONTRADICTS,
    "extends": Relation.EXTENDS,
    "example_of": Relation.EXAMPLE_OF,
}


@dataclass(frozen=True, slots=True)
class Candidate:
    a: Concept
    b: Concept
    similarity: float


@dataclass(frozen=True, slots=True)
class Verdict:
    a: str
    b: str
    similarity: float
    relation: str | None  # None: the model's reply was unusable
    confidence: str | None
    rationale: str | None
    edge_id: str | None

    def as_json(self) -> dict[str, Any]:
        return asdict(self)


def origin(skill: Skill) -> str:
    return f"skill:{SKILL_NAME}@{skill.version}"


def _concept_edges(session: Session) -> list[Edge]:
    return list(
        session.exec(
            select(Edge).where(
                (col(Edge.src_kind) == EntityKind.CONCEPT)
                | (col(Edge.dst_kind) == EntityKind.CONCEPT)
            )
        ).all()
    )


def evidence_by_concept(session: Session) -> dict[str, list[tuple[float, str]]]:
    """Concept id → (score, qualified anchor) of every passage its live edges cite."""
    out: dict[str, list[tuple[float, str]]] = defaultdict(list)
    for e in _concept_edges(session):
        if e.status is EdgeStatus.REJECTED:
            continue
        score = e.weight * max(len(e.evidence), 1)
        ends = ((e.src_kind, e.src_id), (e.dst_kind, e.dst_id))
        nodes = [i for k, i in ends if k is EntityKind.NODE]
        for kind, ref in ends:
            if kind is EntityKind.CONCEPT:
                out[ref].extend((score, a) for a in dict.fromkeys([*e.evidence, *nodes]))
    return out


def books_of(evidence: dict[str, list[tuple[float, str]]]) -> dict[str, set[uuid.UUID]]:
    return {
        concept: {p[0] for _, ref in refs if (p := split_anchor(ref)) is not None}
        for concept, refs in evidence.items()
    }


def _related_pairs(session: Session) -> set[frozenset[str]]:
    """Concept pairs that already carry an edge: judged, linked, merged, or rejected."""
    return {
        frozenset((e.src_id, e.dst_id))
        for e in _concept_edges(session)
        if e.src_kind is EntityKind.CONCEPT and e.dst_kind is EntityKind.CONCEPT
    }


def candidates(
    session: Session,
    *,
    embedder: DenseEmbedder,
    threshold: float,
    ceiling: float,
    limit: int,
    document_id: uuid.UUID | None = None,
) -> list[Candidate]:
    """Unjudged pairs in no common book, most similar first; with `document_id`, only pairs
    one side of which appears in that book."""
    books = books_of(evidence_by_concept(session))
    pool = [c for c in names.live_concepts(session) if books.get(str(c.id))]
    if len(pool) < 2:
        return []
    related = _related_pairs(session)
    texts = [concept_text(c) for c in pool]
    release(session)  # no transaction open while embedding
    vectors = embedder.dense(texts)
    found: list[Candidate] = []
    for i, a in enumerate(pool):
        for j in range(i + 1, len(pool)):
            b = pool[j]
            mine, theirs = books[str(a.id)], books[str(b.id)]
            if mine & theirs or frozenset((str(a.id), str(b.id))) in related:
                continue
            if document_id is not None and document_id not in mine | theirs:
                continue
            similarity = cosine(vectors[i], vectors[j])
            if threshold <= similarity < ceiling:
                found.append(Candidate(a=a, b=b, similarity=similarity))
    return sorted(found, key=lambda c: (-c.similarity, str(c.a.id), str(c.b.id)))[:limit]


def _side(
    session: Session, concept: Concept, refs: Sequence[tuple[float, str]], letter: str
) -> tuple[dict[str, Any], dict[str, str]]:
    """One side of the prompt, and its passage ids → qualified anchors."""
    ranked = [ref for _, ref in sorted(refs, key=lambda r: -r[0])]
    wanted = [(p[0], p[1], ref) for ref in dict.fromkeys(ranked) if (p := split_anchor(ref))]
    keys = sorted({(doc, anchor) for doc, anchor, _ in wanted})
    found = (
        session.exec(
            select(Node).where(tuple_(col(Node.document_id), col(Node.anchor)).in_(keys))
        ).all()
        if keys
        else []
    )
    rows = {node_ref(n.document_id, n.anchor): n for n in found}
    passages: list[dict[str, Any]] = []
    ids: dict[str, str] = {}
    for _, _, ref in wanted:
        node = rows.get(ref)
        if node is None or not (node.text or node.heading):
            continue
        pid = f"{letter}{len(passages) + 1}"
        passages.append(
            {
                "id": pid,
                "heading": node.heading,
                "text": clip(node.text or node.heading, PASSAGE_CHARS),
            }
        )
        ids[pid] = ref
        if len(passages) == PASSAGES_PER_SIDE:
            break
    doc_ids = {uuid.UUID(ref.split("#", 1)[0]) for ref in ids.values()}
    titles = sorted(session.exec(select(Document.title).where(col(Document.id).in_(doc_ids))).all())
    side = {
        "canonical": concept.canonical,
        "kind": concept.kind.value,
        "blurb": concept.blurb,
        "book": ", ".join(titles),
        "passages": passages,
    }
    return side, ids


def _checker(skill: Skill, ids: dict[str, str]) -> Callable[[Any], list[str]]:
    """Schema problems, then: cited ids exist, and a relation cites both books."""

    def problems(output: Any) -> list[str]:
        # Not `output_problems`: it reads `evidence` as document anchors; these are passage ids.
        found = schema_errors(skill.schema, output)
        if found or not isinstance(output, dict):
            return found
        cited = output.get("evidence", [])
        unknown = [c for c in cited if c not in ids]
        if unknown:
            return [f"evidence cites passages that are not in the input: {', '.join(unknown)}"]
        if output.get("relation") != "none" and not (
            any(c.startswith("A") for c in cited) and any(c.startswith("B") for c in cited)
        ):
            return [
                "a relation needs evidence from both sides: cite at least one A and one B passage"
            ]
        return []

    return problems


def judge(session: Session, candidate: Candidate, *, runner: ModelRunner, skill: Skill) -> Verdict:
    """Ask the model; store the verdict as a proposed (or rejected) edge. Commits."""
    refs = evidence_by_concept(session)
    side_a, ids_a = _side(session, candidate.a, refs.get(str(candidate.a.id), []), "A")
    side_b, ids_b = _side(session, candidate.b, refs.get(str(candidate.b.id), []), "B")
    ids = {**ids_a, **ids_b}
    pair = {"similarity": round(candidate.similarity, 3), "a": side_a, "b": side_b}
    prompt = render_prompt(skill.prompt, {"pair": pair})
    a_id, b_id = str(candidate.a.id), str(candidate.b.id)
    release(session)  # no transaction open through the CLI run(s)
    try:
        run = run_structured(runner, prompt, tier=skill.meta.tier, validate=_checker(skill, ids))
    except OutputError:
        return Verdict(a_id, b_id, candidate.similarity, None, None, None, None)
    output = run.output
    verdict = str(output["relation"])
    relation = _RELATIONS.get(verdict, Relation.SUPPORTS)  # `none` is stored rejected
    src, dst = (
        (candidate.a, candidate.b)
        if output["direction"] == "a_to_b"
        else (candidate.b, candidate.a)
    )
    cited = [ids[c] for c in output["evidence"] if c in ids]
    draft = EdgeDraft(
        src=Ref.concept(src.id),
        dst=Ref.concept(dst.id),
        relation=relation,
        weight=CONFIDENCE_WEIGHT.get(str(output["confidence"]), 0.4),
        evidence=cited or list(ids.values())[:2],
        origin=origin(skill),
        status=EdgeStatus.REJECTED if verdict == "none" else EdgeStatus.PROPOSED,
        meta={
            "verdict": verdict,
            "similarity": round(candidate.similarity, 4),
            "confidence": str(output["confidence"]),
            "rationale": str(output["rationale"]),
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
        relation=verdict,
        confidence=str(output["confidence"]),
        rationale=str(output["rationale"]),
        edge_id=str(edge.id),
    )


def run_bridges(
    session: Session,
    *,
    runner: ModelRunner,
    embedder: DenseEmbedder,
    skills_dir: Path,
    threshold: float,
    ceiling: float,
    limit: int,
    document_id: uuid.UUID | None = None,
) -> list[Verdict]:
    """Propose cross-book relations for the most similar unjudged pairs. Never accepts."""
    found = candidates(
        session,
        embedder=embedder,
        threshold=threshold,
        ceiling=ceiling,
        limit=limit,
        document_id=document_id,
    )
    if not found:
        return []
    skill = load_skill(skills_dir / SKILL_NAME)
    return [judge(session, c, runner=runner, skill=skill) for c in found]

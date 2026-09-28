"""The claim tracker's cross-paper pass (docs/PAPERS.md §5): which claims of different papers
bear on each other, judged by the `relate-claims` skill. Mirrors `app.graph.bridges`:

    claims of different papers ─ embed each sentence ─ cosine ≥ threshold (calibrated bar)
      → skip pairs that already carry any claim ↔ claim edge (any relation, any status)
      → each side's evidence passages (its `claims.evidence` anchors, in order), labelled
        A1, A2… and B1, B2…, so the model cites passages rather than recalling the papers
      → `relate-claims` (tier `reason`) through the `ModelRunner`
      → supports | contradicts | extends: a claim ↔ claim edge, status **proposed**,
        evidence the cited passages (at least one from each paper), weight by confidence
        none: a **rejected** edge, so the pair is never asked about again

Nothing is accepted automatically: a human accepts or rejects each relation
(`PATCH /edges/{id}`). Each verdict commits, so a retried job never asks a pair twice.

The job (`relate_claims`, one per paper, queued by `papers.materialize` when claims come,
or for every paper by `POST /papers/claims/relate`) embeds claim sentences with the same
dense model as the Qdrant `claims` points; it does not read Qdrant, so it runs in any
worker, also when the API owns the embedded store.
"""

import uuid
from collections.abc import Callable, Sequence
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from sqlalchemy import tuple_
from sqlmodel import Session, col, select

from app.core.config import get_settings
from app.db.session import release
from app.graph.dedup import DenseEmbedder, cosine
from app.graph.edges import EdgeDraft, find_edge
from app.graph.evidence import clip
from app.graph.refs import Ref
from app.jobs.queue import JobSpec
from app.jobs.registry import HandlerResult, PermanentJobError
from app.models import Claim, Document, Edge, Job, Node, node_ref
from app.models.enums import EdgeStatus, EntityKind, JobKind, JobState, Relation
from app.pipeline import ceiling
from app.pipeline.gates import schema_errors
from app.pipeline.hashing import input_hash
from app.pipeline.runner import ModelRunner, OutputError, run_structured
from app.pipeline.skills import Skill, load_skill, render_prompt

SKILL_NAME = "relate-claims"
RELATE_PRIORITY = 135  # after the concept bridges (130): claims are judged last
PASSAGES_PER_SIDE = 3
PASSAGE_CHARS = 700
CONFIDENCE_WEIGHT = {"high": 0.8, "medium": 0.6, "low": 0.4}
RELATIONS = {
    "supports": Relation.SUPPORTS,
    "contradicts": Relation.CONTRADICTS,
    "extends": Relation.EXTENDS,
}
Vectors = Callable[[Sequence[str]], list[list[float]]]


def relate_spec(document_id: uuid.UUID, key: Sequence[str] = ()) -> JobSpec:
    """A `relate_claims` job for one paper. `key` (e.g. the new claim ids) separates
    requests: the same claims queued twice dedupe in the queue."""
    return JobSpec(
        kind=JobKind.RELATE_CLAIMS,
        document_id=document_id,
        input_hash=input_hash(SKILL_NAME, "1", {"document": str(document_id), "key": sorted(key)}),
        priority=RELATE_PRIORITY,
    )


@dataclass(frozen=True, slots=True)
class Candidate:
    a: Claim
    b: Claim
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


def judged_pairs(session: Session) -> set[frozenset[str]]:
    """Claim pairs that already carry an edge: proposed, accepted, rejected, or drawn."""
    rows = session.exec(
        select(Edge.src_id, Edge.dst_id).where(
            Edge.src_kind == EntityKind.CLAIM, Edge.dst_kind == EntityKind.CLAIM
        )
    ).all()
    return {frozenset((src, dst)) for src, dst in rows}


def candidates(
    session: Session,
    *,
    vectors: Vectors,
    threshold: float,
    limit: int,
    document_id: uuid.UUID | None = None,
) -> list[Candidate]:
    """Unjudged pairs of claims from different papers at cosine ≥ `threshold`, most similar
    first; with `document_id`, only pairs one side (`a`) of which is that paper's."""
    pool = list(session.exec(select(Claim).order_by(col(Claim.document_id), col(Claim.key))).all())
    if document_id is not None and not any(c.document_id == document_id for c in pool):
        return []
    judged = judged_pairs(session)
    texts = [c.text for c in pool]
    release(session)  # no transaction open while embedding
    embedded = vectors(texts) if len(pool) > 1 else []
    found: list[Candidate] = []
    for i, a in enumerate(pool):
        for j in range(i + 1, len(pool)):
            b = pool[j]
            if a.document_id == b.document_id:
                continue
            if document_id is not None and document_id not in (a.document_id, b.document_id):
                continue
            if frozenset((str(a.id), str(b.id))) in judged:
                continue
            similarity = cosine(embedded[i], embedded[j])
            if similarity >= threshold:  # the job's own paper is side `a` (passages A1…)
                first, second = (b, a) if b.document_id == document_id else (a, b)
                found.append(Candidate(a=first, b=second, similarity=similarity))
    return sorted(found, key=lambda c: (-c.similarity, str(c.a.id), str(c.b.id)))[:limit]


def _side(session: Session, claim: Claim, letter: str) -> tuple[dict[str, Any], dict[str, str]]:
    """One side of the prompt, and its passage ids → qualified anchors."""
    keys = [(claim.document_id, anchor) for anchor in dict.fromkeys(claim.evidence)]
    rows = session.exec(
        select(Node).where(tuple_(col(Node.document_id), col(Node.anchor)).in_(keys))
    ).all()
    nodes = {n.anchor: n for n in rows}
    passages: list[dict[str, Any]] = []
    ids: dict[str, str] = {}
    for _, anchor in keys:
        node = nodes.get(anchor)
        if node is None or not (node.text or node.heading):
            continue
        pid = f"{letter}{len(passages) + 1}"
        text = node.text or node.heading or ""
        passages.append({"id": pid, "heading": node.heading, "text": clip(text, PASSAGE_CHARS)})
        ids[pid] = node_ref(claim.document_id, anchor)
        if len(passages) == PASSAGES_PER_SIDE:
            break
    document = session.get(Document, claim.document_id)
    side = {
        "paper": document.title if document else None,
        "year": document.year if document else None,
        "claim": claim.text,
        "kind": claim.kind.value,
        "strength": claim.strength.value,
        "passages": passages,
    }
    return side, ids


def checker(
    skill: Skill, ids: dict[str, str], years: tuple[int | None, int | None] = (None, None)
) -> Callable[[Any], list[str]]:
    """Schema problems, then: cited ids exist, a relation cites both papers, and an `extends`
    does not run backwards in time (`years` = paper a's, paper b's; unknown years pass)."""

    def problems(output: Any) -> list[str]:
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
            return ["a relation needs evidence from both papers: cite at least one A and one B"]
        if output.get("relation") == "extends" and (backwards := _backwards(output, years)):
            return [backwards]
        return []

    return problems


def _backwards(output: dict[str, Any], years: tuple[int | None, int | None]) -> str | None:
    """Why an `extends` verdict reads backwards in time, or None: work builds on earlier work,
    so the extending paper cannot be older than the one it extends."""
    later, earlier = years if output.get("direction") == "a_to_b" else years[::-1]
    if later is None or earlier is None or later >= earlier:
        return None
    return (
        f"`extends` reads {output.get('direction')}, but the extending paper ({later}) is older "
        f"than the one it would extend ({earlier}); check `direction`, or pick another relation"
    )


def judge(session: Session, candidate: Candidate, *, runner: ModelRunner, skill: Skill) -> Verdict:
    """Ask the model; store the verdict as a proposed (or rejected) edge. Commits."""
    side_a, ids_a = _side(session, candidate.a, "A")
    side_b, ids_b = _side(session, candidate.b, "B")
    ids = {**ids_a, **ids_b}
    pair = {"similarity": round(candidate.similarity, 3), "a": side_a, "b": side_b}
    prompt = render_prompt(skill.prompt, {"pair": pair})
    a, b = candidate.a, candidate.b
    a_id, b_id = str(a.id), str(b.id)
    release(session)  # no transaction open through the CLI run(s)
    try:
        years = (side_a["year"], side_b["year"])
        run = run_structured(
            runner, prompt, tier=skill.meta.tier, validate=checker(skill, ids, years)
        )
    except OutputError:
        return Verdict(a_id, b_id, candidate.similarity, None, None, None, None)
    output = run.output
    verdict = str(output["relation"])
    src, dst = (a, b) if output["direction"] == "a_to_b" else (b, a)
    cited = [ids[c] for c in output["evidence"] if c in ids]
    fallback = [node_ref(a.document_id, a.evidence[0]), node_ref(b.document_id, b.evidence[0])]
    draft = EdgeDraft(
        src=Ref.claim(src.id),
        dst=Ref.claim(dst.id),
        relation=RELATIONS.get(verdict, Relation.SUPPORTS),  # `none` is stored rejected
        weight=CONFIDENCE_WEIGHT.get(str(output["confidence"]), 0.4),
        evidence=cited or fallback,
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


def run_relate(
    session: Session,
    *,
    runner: ModelRunner,
    vectors: Vectors,
    skills_dir: Path,
    threshold: float,
    limit: int,
    document_id: uuid.UUID | None = None,
) -> list[Verdict]:
    """Propose cross-paper claim relations for the most similar unjudged pairs."""
    found = candidates(
        session, vectors=vectors, threshold=threshold, limit=limit, document_id=document_id
    )
    if not found:
        return []
    skill = load_skill(skills_dir / SKILL_NAME)
    return [judge(session, c, runner=runner, skill=skill) for c in found]


def run_relate_job(
    session: Session,
    job: Job,
    *,
    runner: ModelRunner,
    embedder: DenseEmbedder | None = None,
    skills_dir: Path | None = None,
) -> HandlerResult:
    """Handler body: relate the job's paper's claims to other papers'. Metered and pausable
    like the bridge pass: each verdict is a CLI run on the paper's ceiling."""
    from app.pipeline.execution import SKILL_JOB_KINDS  # execution imports the papers package

    settings = get_settings()
    document = session.get(Document, job.document_id) if job.document_id else None
    if document is None:
        raise PermanentJobError("relate_claims jobs need an existing document_id")
    ceiling.refuse_if_paused(session, document)
    runner = ceiling.metered(
        runner, session, job, document, SKILL_JOB_KINDS, settings.max_runs_per_document
    )
    if embedder is None:
        from app.retrieval.embedding import get_embedder  # lazy: loads FastEmbed

        embedder = get_embedder()
    payload = job.payload or {}
    verdicts = run_relate(
        session,
        runner=runner,
        vectors=embedder.dense,
        skills_dir=skills_dir or settings.skills_dir,
        threshold=float(payload.get("threshold", settings.claim_relate_threshold)),
        limit=int(payload.get("limit", settings.claim_relate_max_pairs)),
        document_id=document.id,
    )
    related = [v for v in verdicts if v.relation not in (None, "none")]
    return HandlerResult(
        state=JobState.DONE if verdicts else JobState.SKIPPED,
        result={
            "verdicts": [v.as_json() for v in verdicts],
            "proposed": len(related),
        },
    )

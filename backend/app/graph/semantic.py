"""Semantic links from Qdrant: what the text *means*, not only the names it uses (§10, §11).

Mention seeds (`app.graph.mentions`) catch a concept wherever its name appears. Books that
make the same point in different words stay apart. This pass reads the vectors already in
Qdrant (bge-small, the `text` named vector) and adds two classes of edge, both verifiable:

    chapter —echoes→ chapter      passages in the two chapters say similar things
    block   —mentions→ concept    a passage that explains the concept without naming it

**Echoes** come from one Distance Matrix call over `blocks` (`search_matrix_pairs`, every
point sampled, `MATRIX_LIMIT` neighbours each): the nearest-neighbour graph of the whole
shelf. A pair *echoes* when it joins two chapters and scores above a threshold calibrated
on the shelf itself, `max(echo_floor, p95 of all cross-chapter pairs)`, since bge-small's
cosines sit in a narrow 0.7 to 0.9 band and style alone keeps one book's chapters close.
Verbatim repeats (≥ 0.985) and short blocks (titles, list stubs) are ignored. Chapters link
when at least `min_echoes` pairs join them; each keeps its `echo_partners` best. Evidence is
the echoing passages from both sides, so every line opens onto what makes it true.

**Paraphrases** embed each concept as a query (`name: blurb`) and ask `blocks` for its
nearest passages (`query_batch_points`, one request for all concepts). A passage counts when
it scores at least `paraphrase_floor` and within `paraphrase_gap` of the concept's best
passage: relative to the concept, because a crisp concept scores higher than a vague one.
Passages already tied to the concept (by the skill, or as a literal mention) are skipped.

Both classes carry `origin = seed:semantic@1`, are seeds (never keep a concept alive, a
skill edge adopts one), and are rebuilt for the whole shelf at once (`sync`): echoes are
between books, so no document owns them. The embed job runs it after indexing, so the
graph follows the vectors; a change in concepts queues an embed that is a no-op on points.
"""

import logging
import uuid
from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol

from qdrant_client import QdrantClient, models
from sqlmodel import Session, col, select

from app.db.session import release
from app.graph.atlas import chapter_anchor
from app.graph.edges import SEMANTIC_ORIGINS, EdgeDraft, EdgeKey, edge_key, find_edge, origin_in
from app.graph.names import live_concepts
from app.graph.refs import Ref, split_anchor
from app.models import Concept, Edge, Node, node_ref
from app.models.enums import EdgeStatus, EntityKind, NodeKind, Relation
from app.retrieval.client import Collection, collection_name
from app.retrieval.collections import DENSE

logger = logging.getLogger(__name__)

SEMANTIC_VERSION = "1"
SEMANTIC_ORIGIN = f"seed:semantic@{SEMANTIC_VERSION}"
MATRIX_LIMIT = 10
MATRIX_CAP = 50_000  # beyond this the matrix samples: see `echo_pairs`
DUPLICATE = 0.985
MAX_EVIDENCE = 6
BATCH = 32


class QueryEmbedder(Protocol):
    def dense_query(self, text: str) -> list[float]: ...


@dataclass(frozen=True, slots=True)
class Tuning:
    """Thresholds, measured on bge-small over the live shelf (docs/ARCHITECTURE.md §11)."""

    min_chars: int = 120
    echo_floor: float = 0.84
    echo_percentile: float = 0.95
    min_echoes: int = 2
    echo_partners: int = 4
    paraphrase_floor: float = 0.79
    paraphrase_gap: float = 0.07
    paraphrase_per_concept: int = 4
    paraphrase_candidates: int = 12


@dataclass(frozen=True, slots=True)
class Block:
    document_id: uuid.UUID
    anchor: str
    chapter: str

    @property
    def ref(self) -> str:
        return node_ref(self.document_id, self.anchor)

    @property
    def chapter_ref(self) -> Ref:
        return Ref.node(self.document_id, self.chapter)


@dataclass(slots=True)
class Report:
    echoes: int = 0
    paraphrases: int = 0
    threshold: float | None = None
    created: int = 0
    updated: int = 0
    removed: int = 0
    kept: int = 0  # desired, but an edge of another class holds the key

    def as_json(self) -> dict[str, Any]:
        return {k: getattr(self, k) for k in self.__slots__}


@dataclass(slots=True)
class _Pair:
    a: Block
    b: Block
    score: float


@dataclass(slots=True)
class _Echo:
    score: float = 0.0
    pairs: list[_Pair] = field(default_factory=list)


# --- Reading Qdrant ------------------------------------------------------------------------


def _long_enough(tuning: Tuning) -> models.Filter:
    return models.Filter(
        must=[models.FieldCondition(key="char_len", range=models.Range(gte=tuning.min_chars))]
    )


def _blocks(
    client: QdrantClient, chapters: dict[uuid.UUID, set[str]], tuning: Tuning
) -> dict[str, Block]:
    """Point id → block, for every long-enough block of a known document."""
    out: dict[str, Block] = {}
    offset: Any = None
    name = collection_name(Collection.BLOCKS)
    while True:
        points, offset = client.scroll(
            name,
            scroll_filter=_long_enough(tuning),
            limit=512,
            offset=offset,
            with_payload=["document_id", "anchor"],
        )
        for p in points:
            payload = p.payload or {}
            try:
                doc = uuid.UUID(str(payload.get("document_id")))
            except ValueError:
                continue
            anchor = str(payload.get("anchor") or "")
            if doc in chapters and anchor:
                out[str(p.id)] = Block(doc, anchor, chapter_anchor(anchor, chapters[doc]))
        if offset is None:
            return out


def echo_pairs(client: QdrantClient, blocks: dict[str, Block], tuning: Tuning) -> list[_Pair]:
    """Cross-chapter nearest-neighbour pairs over the whole shelf, one matrix call.

    Every point is sampled up to `MATRIX_CAP`; past it Qdrant samples at random, so a very
    large shelf gets a (still useful) different subset of echoes on each run."""
    if len(blocks) < 2:
        return []
    if len(blocks) > MATRIX_CAP:
        logger.warning("Echo matrix sampled", extra={"blocks": len(blocks), "cap": MATRIX_CAP})
    matrix = client.search_matrix_pairs(
        collection_name(Collection.BLOCKS),
        query_filter=_long_enough(tuning),
        sample=min(len(blocks), MATRIX_CAP),
        limit=MATRIX_LIMIT,
        using=DENSE,
        timeout=120,
    )
    seen: set[frozenset[str]] = set()
    out: list[_Pair] = []
    for pair in matrix.pairs:
        a, b = blocks.get(str(pair.a)), blocks.get(str(pair.b))
        key = frozenset((str(pair.a), str(pair.b)))
        if a is None or b is None or key in seen or pair.score >= DUPLICATE:
            continue
        seen.add(key)
        if (a.document_id, a.chapter) != (b.document_id, b.chapter):
            out.append(_Pair(a, b, float(pair.score)))
    return out


def echo_threshold(pairs: Sequence[_Pair], tuning: Tuning) -> float:
    """The shelf's own bar: its 95th-percentile cross-chapter score, never below the floor."""
    if not pairs:
        return tuning.echo_floor
    scores = sorted(p.score for p in pairs)
    at = scores[min(len(scores) - 1, int(len(scores) * tuning.echo_percentile))]
    return max(tuning.echo_floor, at)


def echoes(pairs: Sequence[_Pair], tuning: Tuning) -> tuple[list[EdgeDraft], float]:
    """Chapter pairs joined by enough echoing passages, each chapter's best partners."""
    bar = echo_threshold(pairs, tuning)
    joined: dict[tuple[Ref, Ref], _Echo] = defaultdict(_Echo)
    for p in pairs:
        if p.score < bar:
            continue
        a, b = sorted((p.a.chapter_ref, p.b.chapter_ref), key=str)
        echo = joined[(a, b)]
        echo.score += p.score
        echo.pairs.append(p)
    strong = {k: e for k, e in joined.items() if len(e.pairs) >= tuning.min_echoes}
    best: dict[Ref, list[tuple[float, tuple[Ref, Ref]]]] = defaultdict(list)
    for key, echo in strong.items():
        for end in key:
            best[end].append((echo.score, key))
    chosen = {
        key
        for ranked in best.values()
        for _, key in sorted(ranked, key=lambda r: (-r[0], str(r[1])))[: tuning.echo_partners]
    }
    drafts: list[EdgeDraft] = []
    for a, b in sorted(chosen, key=lambda k: (str(k[0]), str(k[1]))):
        echo = strong[(a, b)]
        ranked = sorted(echo.pairs, key=lambda p: -p.score)
        evidence = list(dict.fromkeys(ref for p in ranked for ref in (p.a.ref, p.b.ref)))
        drafts.append(
            EdgeDraft(
                src=a,
                dst=b,
                relation=Relation.ECHOES,
                weight=round(min(1.0, 0.3 + 0.1 * len(echo.pairs)), 2),
                evidence=evidence[:MAX_EVIDENCE],
                origin=SEMANTIC_ORIGIN,
                status=EdgeStatus.ACCEPTED,
                meta={
                    "pairs": len(echo.pairs),
                    "best": round(ranked[0].score, 4),
                    "threshold": round(bar, 4),
                },
            )
        )
    return drafts, bar


def concept_query(concept: Concept) -> str:
    return f"{concept.canonical}: {concept.blurb}" if concept.blurb else concept.canonical


def _tied(session: Session) -> set[tuple[str, str]]:
    """(qualified block, concept id) pairs some other edge already asserts."""
    rows = session.exec(
        select(Edge).where(
            (col(Edge.src_kind) == EntityKind.CONCEPT) | (col(Edge.dst_kind) == EntityKind.CONCEPT),
            ~origin_in(SEMANTIC_ORIGINS),
        )
    ).all()
    out: set[tuple[str, str]] = set()
    for e in rows:
        concept = e.dst_id if e.dst_kind is EntityKind.CONCEPT else e.src_id
        blocks = [
            i for k, i in ((e.src_kind, e.src_id), (e.dst_kind, e.dst_id)) if k is EntityKind.NODE
        ]
        out.update((b, concept) for b in [*blocks, *e.evidence])
    return out


def paraphrases(
    session: Session,
    client: QdrantClient,
    embedder: QueryEmbedder,
    blocks: dict[str, Block],
    tuning: Tuning,
) -> list[EdgeDraft]:
    """Passages that explain a concept without naming it, one batch of queries for all."""
    concepts = [c for c in live_concepts(session) if c.blurb]
    if not concepts or not blocks:
        return []
    tied = _tied(session)
    release(session)  # no transaction open while embedding and querying
    queries = [embedder.dense_query(concept_query(c)) for c in concepts]
    results: list[models.QueryResponse] = []
    for start in range(0, len(queries), BATCH):
        results += client.query_batch_points(
            collection_name(Collection.BLOCKS),
            requests=[
                models.QueryRequest(
                    query=vector,
                    using=DENSE,
                    filter=_long_enough(tuning),
                    limit=tuning.paraphrase_candidates,
                )
                for vector in queries[start : start + BATCH]
            ],
        )
    drafts: list[EdgeDraft] = []
    for concept, result in zip(concepts, results, strict=True):
        hits = [(blocks.get(str(p.id)), float(p.score)) for p in result.points]
        best = max((s for _, s in hits), default=0.0)
        bar = max(tuning.paraphrase_floor, best - tuning.paraphrase_gap)
        kept = [
            (block, score)
            for block, score in hits
            if block is not None and score >= bar and (block.ref, str(concept.id)) not in tied
        ][: tuning.paraphrase_per_concept]
        for block, score in kept:
            drafts.append(
                EdgeDraft(
                    src=Ref.node(block.document_id, block.anchor),
                    dst=Ref.concept(concept.id),
                    relation=Relation.MENTIONS,
                    weight=round(min(0.6, max(0.2, (score - 0.6) * 2)), 2),
                    evidence=[block.ref],
                    origin=SEMANTIC_ORIGIN,
                    status=EdgeStatus.ACCEPTED,
                    meta={"via": "paraphrase", "score": round(score, 4)},
                )
            )
    return drafts


# --- Writing the graph ---------------------------------------------------------------------


def _chapters(session: Session) -> dict[uuid.UUID, set[str]]:
    rows = session.exec(select(Node.document_id, Node.anchor, Node.kind)).all()
    out: dict[uuid.UUID, set[str]] = {}
    for doc, anchor, kind in rows:
        mine = out.setdefault(doc, set())  # every document with nodes, chapters or not
        if kind is NodeKind.CHAPTER:
            mine.add(anchor)
    return out


def _write(session: Session, drafts: Iterable[EdgeDraft], report: Report) -> None:
    """Make the semantic class exactly `drafts`: shelf-wide, so no document owns it."""
    wanted: dict[EdgeKey, EdgeDraft] = {d.key: d for d in drafts}
    for key, draft in wanted.items():
        edge = find_edge(session, key)
        if edge is None:
            session.add(draft.row())
            report.created += 1
        elif edge.origin.startswith(SEMANTIC_ORIGINS[0].rstrip("%")):
            edge.weight, edge.evidence, edge.meta = draft.weight, draft.evidence, dict(draft.meta)
            session.add(edge)
            report.updated += 1
        else:
            report.kept += 1
    for edge in session.exec(select(Edge).where(origin_in(SEMANTIC_ORIGINS))).all():
        if edge_key(edge) not in wanted:
            session.delete(edge)
            report.removed += 1
    session.commit()


def valid(drafts: Iterable[EdgeDraft], session: Session) -> list[EdgeDraft]:
    """Drop drafts whose endpoints vanished between reading Qdrant and writing Postgres."""
    live = {str(c.id) for c in live_concepts(session)}
    anchors = {node_ref(d, a) for d, a in session.exec(select(Node.document_id, Node.anchor)).all()}
    out = []
    for d in drafts:
        ends = [(d.src.kind, d.src.id), (d.dst.kind, d.dst.id)]
        ok = all(
            (i in live)
            if k is EntityKind.CONCEPT
            else (i in anchors and split_anchor(i) is not None)
            for k, i in ends
        )
        if ok:
            out.append(d)
    return out


def sync(
    session: Session,
    client: QdrantClient,
    embedder: QueryEmbedder,
    *,
    tuning: Tuning | None = None,
) -> Report:
    """Rebuild the shelf's echoes and paraphrase mentions from Qdrant. Commits."""
    tuning = tuning or Tuning()
    report = Report()
    chapters = _chapters(session)
    release(session)
    blocks = _blocks(client, chapters, tuning)
    echo_drafts, report.threshold = echoes(echo_pairs(client, blocks, tuning), tuning)
    para_drafts = paraphrases(session, client, embedder, blocks, tuning)
    drafts = valid([*echo_drafts, *para_drafts], session)
    report.echoes = sum(1 for d in drafts if d.relation is Relation.ECHOES)
    report.paraphrases = len(drafts) - report.echoes
    _write(session, drafts, report)
    return report

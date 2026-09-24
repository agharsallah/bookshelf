"""`search`: route the query, then answer it the cheapest way its intent allows.

* **Addressed** — a tree fetch: the node plus its approved artifacts. No vectors.
* **Lexical** — Postgres full-text (`lexical`).
* **Discovery / Synthesis** — the two vector tiers (`hybrid`), then one cross-encoder pass
  over the merged candidate set ("reranking sits above both tiers", §10). Synthesis is
  restricted to the documents the query names when it names two or more, and adds the
  idea graph's concept relations between the result documents (`relations`).

Groups are ordered by their best hit; hits inside a group by score.
"""

import logging
import time
import uuid
from collections import OrderedDict
from dataclasses import dataclass

from qdrant_client import QdrantClient
from sqlmodel import Session, col, select

from app.models import Artifact, Node
from app.models.enums import ArtifactType, Review
from app.retrieval import hybrid, lexical, relations, resolve
from app.retrieval.collections import (
    QdrantUnavailableError,
    ensure_ready,
    forget,
    is_empty,
    open_client,
)
from app.retrieval.embedding import Embedder
from app.retrieval.points import flatten_body
from app.retrieval.refs import document_ref, load_refs, snippet
from app.retrieval.router import QueryRouter, Route, is_lexical
from app.schemas.search import (
    IndexState,
    ResolvedAddress,
    SearchFilters,
    SearchGroup,
    SearchHit,
    SearchRequest,
    SearchResponse,
)
from app.services.render_markdown import body_blocks

logger = logging.getLogger(__name__)

RERANK_CHARS = 1500
# Addressed hits: the artifact a reader most likely wants first.
_TYPE_ORDER = [
    ArtifactType.CHAPTER_DISTILLATION,
    ArtifactType.BOOK_BRIEF,
    ArtifactType.SECTION_NOTE,
    ArtifactType.CHAPTER_SUMMARY,
    ArtifactType.BOOK_SUMMARY,
]


@dataclass(frozen=True, slots=True)
class SearchOutcome:
    route: Route
    response: SearchResponse


# --- Addressed ------------------------------------------------------------------------


def _rank(kind: ArtifactType) -> int:
    return _TYPE_ORDER.index(kind) if kind in _TYPE_ORDER else len(_TYPE_ORDER)


def artifacts_at(session: Session, document_id: uuid.UUID, anchor: str | None) -> list[Artifact]:
    """The latest approved artifact per (type, note) scoped exactly to `anchor`."""
    query = select(Artifact).where(
        Artifact.document_id == document_id, Artifact.review == Review.APPROVED
    )
    query = query.where(
        col(Artifact.anchor).is_(None) if anchor is None else Artifact.anchor == anchor
    )
    rows = session.exec(query.order_by(col(Artifact.version).desc())).all()
    latest: dict[tuple[ArtifactType, uuid.UUID | None], Artifact] = {}
    for artifact in rows:
        latest.setdefault((artifact.type, artifact.note_id), artifact)
    return sorted(latest.values(), key=lambda a: (_rank(a.type), a.type.value))


def _node_hit(node: Node) -> SearchHit:
    return SearchHit(
        kind="block",
        anchor=node.anchor,
        heading=node.heading,
        score=1.0,
        snippet=snippet(node.text or node.heading or ""),
    )


def _addressed(session: Session, route: Route) -> tuple[ResolvedAddress, list[SearchGroup]]:
    document = route.document
    assert document is not None  # noqa: S101  (addressed routes always carry one)
    heading = document.title
    hits: list[SearchHit] = []
    if route.anchor is not None:
        node = resolve.node_at(session, document.id, route.anchor)
        if node is not None:
            hits.append(_node_hit(node))
            heading = node.heading or heading
    for artifact in artifacts_at(session, document.id, route.anchor):
        hits.append(
            SearchHit(
                kind="distillation",
                anchor=artifact.anchor,
                type=artifact.type,
                artifact_id=artifact.id,
                heading=heading,
                score=1.0,
                snippet=snippet(flatten_body(artifact.body)),
                blocks=body_blocks(artifact.body),
            )
        )
    ref = document_ref(document)
    return ResolvedAddress(document=ref, anchor=route.anchor), [
        SearchGroup(document=ref, hits=hits)
    ]


# --- Vector tiers ---------------------------------------------------------------------


def _scoped(filters: SearchFilters, route: Route) -> SearchFilters:
    """Narrow the caller's filters to the documents the route named, if any."""
    if not route.document_ids:
        return filters
    named = list(route.document_ids)
    if filters.document_ids:
        named = [i for i in named if i in set(filters.document_ids)] or list(filters.document_ids)
    return filters.model_copy(update={"document_ids": named})


def _hit(candidate: hybrid.Candidate, score: float) -> SearchHit:
    payload = candidate.payload
    is_distillation = candidate.kind == "distillation"
    return SearchHit(
        kind=candidate.kind,
        anchor=payload.get("anchor"),
        type=ArtifactType(payload["type"]) if is_distillation else None,
        artifact_id=uuid.UUID(payload["artifact_id"]) if is_distillation else None,
        heading=payload.get("heading"),
        score=score,
        snippet=snippet(candidate.text),
    )


def _vector(
    session: Session,
    request: SearchRequest,
    route: Route,
    *,
    embedder: Embedder,
    client: QdrantClient,
) -> list[SearchGroup]:
    filters = _scoped(request.filters, route)
    ensure_ready(client, dense_dim=embedder.dense_dim)  # first search creates the layout
    vectors = hybrid.QueryVectors.embed(embedder, request.query)
    groups = max(request.limit, 2) if route.intent == "synthesis" else request.limit
    distillations, _ = hybrid.distillation_groups(client, vectors, filters, groups=groups)
    if distillations:
        scopes = hybrid.scopes_of(distillations)
        evidence, _ = hybrid.evidence_blocks(client, vectors, scopes, filters.tags)
    else:  # nothing distilled (yet): search the blocks directly
        evidence, _ = hybrid.block_groups(client, vectors, filters, groups=groups)
    candidates = distillations + evidence
    scores = embedder.rerank(request.query, [c.text[:RERANK_CHARS] for c in candidates])
    ranked = sorted(zip(candidates, scores, strict=True), key=lambda pair: -pair[1])
    by_document: OrderedDict[str, list[SearchHit]] = OrderedDict()
    for candidate, score in ranked:
        by_document.setdefault(candidate.document_id, []).append(_hit(candidate, score))
    # Postgres, not the index, says which documents exist and what they are called (D1):
    # points outlive a deleted document until its purge job runs, and payloads a title edit.
    refs = load_refs(session, list(by_document))
    return [
        SearchGroup(document=refs[doc_id], hits=hits)
        for doc_id, hits in by_document.items()
        if doc_id in refs
    ]


def _vector_search(
    session: Session,
    request: SearchRequest,
    route: Route,
    *,
    embedder: Embedder,
    client: QdrantClient | None,
) -> tuple[list[SearchGroup], IndexState]:
    """The vector tiers, degrading instead of failing: collections that vanished are
    recreated once (then the index is `empty`), and an unreachable Qdrant yields no groups
    with `unavailable`. Addressed and lexical queries never come here."""
    try:
        client = client or open_client()
        try:
            groups = _vector(session, request, route, embedder=embedder, client=client)
        except QdrantUnavailableError:
            raise
        except Exception:  # e.g. "Collection distillations not found": rebuild the layout
            forget(client)
            groups = _vector(session, request, route, embedder=embedder, client=client)
        return groups, "ready" if groups or not is_empty(client) else "empty"
    except QdrantUnavailableError:
        return [], "unavailable"
    except Exception as exc:  # the retry failed too: treat Qdrant as unavailable
        logger.warning("Vector search failed", extra={"error": f"{type(exc).__name__}: {exc}"})
        return [], "unavailable"


# --- Entry point ----------------------------------------------------------------------


def run(
    session: Session,
    request: SearchRequest,
    *,
    router: QueryRouter,
    embedder: Embedder,
    client: QdrantClient | None = None,
    route: Route | None = None,
) -> SearchOutcome:
    """Route `request` (unless `route` is given) and run the search its intent calls for."""
    started = time.perf_counter()
    route = route or router.route(session, request.query, request.mode)
    resolved: ResolvedAddress | None = None
    index_state: IndexState | None = None
    if route.intent == "addressed":
        resolved, groups = _addressed(session, route)
    elif route.intent == "lexical":
        phrase = route.phrase or request.query
        # Quotes or "exact phrase" ask for the words in order; otherwise all terms, anywhere.
        exact = is_lexical(request.query)
        groups = lexical.search(session, phrase, request.filters, limit=request.limit, exact=exact)
    else:
        groups, index_state = _vector_search(
            session, request, route, embedder=embedder, client=client
        )
    edges = (
        relations.between(session, [g.document for g in groups])
        if route.intent == "synthesis"
        else []
    )
    took_ms = int((time.perf_counter() - started) * 1000)
    response = SearchResponse(
        intent=route.intent,
        resolved=resolved,
        groups=groups,
        relations=edges,
        index_state=index_state,
        took_ms=took_ms,
    )
    return SearchOutcome(route=route, response=response)

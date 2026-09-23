"""The two vector tiers of §10, over Qdrant's Query API.

Tier 1 searches `distillations` to decide *what* is relevant: a dense and a BM25 prefetch
fused with RRF (scores of cosine and BM25 are on incomparable scales, which is exactly
where the guidance says to start with RRF), grouped by `document_id` so one verbose book
cannot take every slot, with `with_lookup` pulling each document's metadata from the
`documents` collection instead of copying it onto every point.

Tier 2 fetches *evidence* from `blocks`, restricted to the chosen documents and to the
scopes (anchor prefixes, via the `section_path` payload) their distillations cover.

Prefetch sizing follows the guidance for grouped hybrid search:
`prefetch_limit >= final_limit * expected_chunks_per_document`, or relevant documents
silently drop out during grouping.

Docs: https://qdrant.tech/documentation/concepts/hybrid-queries/ ·
https://qdrant.tech/documentation/concepts/search/#search-groups ·
https://qdrant.tech/documentation/tutorials-search-engineering/multi-representation-search/
"""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Literal

from qdrant_client import QdrantClient, models

from app.models.enums import Review
from app.retrieval.client import Collection, collection_name
from app.retrieval.collections import DENSE, SPARSE
from app.retrieval.embedding import Embedder
from app.schemas.search import SearchFilters

DISTILLATIONS_PER_DOC = 3
EVIDENCE_PER_DOC = 3
# Expected points per document, for prefetch sizing: a book has a few dozen chapter and
# section artifacts, and hundreds to thousands of blocks (evidence is scope-filtered).
EXPECTED_DISTILLATIONS = 30
EXPECTED_BLOCKS = 60
PREFETCH_CAP = 1000


@dataclass(frozen=True, slots=True)
class QueryVectors:
    dense: list[float]
    sparse: models.SparseVector

    @classmethod
    def embed(cls, embedder: Embedder, query: str) -> "QueryVectors":
        return cls(embedder.dense_query(query), embedder.sparse_query(query))


@dataclass(frozen=True, slots=True)
class Candidate:
    """One vector hit before reranking."""

    kind: Literal["distillation", "block"]
    document_id: str
    payload: dict[str, Any]
    fused: float

    @property
    def text(self) -> str:
        return str(self.payload.get("text") or "")


Lookups = dict[str, dict[str, Any]]  # document_id → `documents` payload


def prefetch_limit(groups: int, per_document: int) -> int:
    return min(PREFETCH_CAP, max(groups, 1) * per_document)


def _match_any(key: str, values: list[str]) -> models.FieldCondition:
    return models.FieldCondition(key=key, match=models.MatchAny(any=values))


def scope_filter(filters: SearchFilters, *, distillations: bool) -> models.Filter | None:
    must: list[models.Condition] = []
    if filters.document_ids:
        must.append(_match_any("document_id", [str(i) for i in filters.document_ids]))
    if filters.tags:
        must.append(_match_any("tags", list(filters.tags)))
    if distillations:
        if filters.types:
            must.append(_match_any("type", [t.value for t in filters.types]))
        must.append(
            models.FieldCondition(
                key="review", match=models.MatchValue(value=Review.APPROVED.value)
            )
        )
    return models.Filter(must=must) if must else None


def _hybrid(vectors: QueryVectors, limit: int, flt: models.Filter | None) -> list[models.Prefetch]:
    return [
        models.Prefetch(query=vectors.dense, using=DENSE, limit=limit, filter=flt),
        models.Prefetch(query=vectors.sparse, using=SPARSE, limit=limit, filter=flt),
    ]


def _grouped(
    client: QdrantClient,
    collection: Collection,
    kind: Literal["distillation", "block"],
    vectors: QueryVectors,
    flt: models.Filter | None,
    *,
    groups: int,
    group_size: int,
    per_document: int,
) -> tuple[list[Candidate], Lookups]:
    result = client.query_points_groups(
        collection_name(collection),
        prefetch=_hybrid(vectors, prefetch_limit(groups, per_document), flt),
        query=models.FusionQuery(fusion=models.Fusion.RRF),
        query_filter=flt,
        group_by="document_id",
        limit=groups,
        group_size=group_size,
        with_payload=True,
        with_lookup=models.WithLookup(
            collection=collection_name(Collection.DOCUMENTS), with_payload=True, with_vectors=False
        ),
    )
    candidates: list[Candidate] = []
    lookups: Lookups = {}
    for group in result.groups:
        doc_id = str(group.id)
        if group.lookup is not None and group.lookup.payload:
            lookups[doc_id] = dict(group.lookup.payload)
        candidates += [
            Candidate(kind, doc_id, dict(hit.payload or {}), hit.score) for hit in group.hits
        ]
    return candidates, lookups


def distillation_groups(
    client: QdrantClient, vectors: QueryVectors, filters: SearchFilters, *, groups: int
) -> tuple[list[Candidate], Lookups]:
    """Tier 1: the best distillations of the `groups` most relevant documents."""
    return _grouped(
        client,
        Collection.DISTILLATIONS,
        "distillation",
        vectors,
        scope_filter(filters, distillations=True),
        groups=groups,
        group_size=DISTILLATIONS_PER_DOC,
        per_document=EXPECTED_DISTILLATIONS,
    )


def block_groups(
    client: QdrantClient, vectors: QueryVectors, filters: SearchFilters, *, groups: int
) -> tuple[list[Candidate], Lookups]:
    """Blocks grouped by document: the fallback when nothing is distilled yet."""
    return _grouped(
        client,
        Collection.BLOCKS,
        "block",
        vectors,
        scope_filter(filters, distillations=False),
        groups=groups,
        group_size=EVIDENCE_PER_DOC,
        per_document=EXPECTED_BLOCKS,
    )


def evidence_filter(scopes: Mapping[str, set[str] | None]) -> models.Filter:
    """Blocks of the chosen documents, under the anchors their distillations cover.

    `None` for a document means document-scope artifacts matched: any of its blocks.
    """
    per_document: list[models.Condition] = []
    for doc_id, anchors in scopes.items():
        doc = models.FieldCondition(key="document_id", match=models.MatchValue(value=doc_id))
        if anchors is None:
            per_document.append(models.Filter(must=[doc]))
            continue
        under: list[models.Condition] = [
            _match_any("section_path", sorted(anchors)),
            _match_any("anchor", sorted(anchors)),
        ]
        per_document.append(models.Filter(must=[doc], should=under))
    return models.Filter(should=per_document)


def evidence_blocks(
    client: QdrantClient,
    vectors: QueryVectors,
    scopes: Mapping[str, set[str] | None],
    tags: list[str] | None,
) -> tuple[list[Candidate], Lookups]:
    """Tier 2: up to `EVIDENCE_PER_DOC` blocks per chosen document, inside its scopes."""
    if not scopes:
        return [], {}
    flt = evidence_filter(scopes)
    if tags:
        flt.must = [_match_any("tags", tags)]
    return _grouped(
        client,
        Collection.BLOCKS,
        "block",
        vectors,
        flt,
        groups=len(scopes),
        group_size=EVIDENCE_PER_DOC,
        per_document=EXPECTED_BLOCKS,
    )


def scopes_of(candidates: list[Candidate]) -> dict[str, set[str] | None]:
    """Per document: the anchors its distillation hits cover (None = the whole document)."""
    scopes: dict[str, set[str] | None] = {}
    for candidate in candidates:
        anchor = candidate.payload.get("anchor")
        current = scopes.get(candidate.document_id, set())
        if anchor is None or current is None:
            scopes[candidate.document_id] = None
        else:
            scopes[candidate.document_id] = current | {str(anchor)}
    return scopes

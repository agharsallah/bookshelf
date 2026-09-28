"""Sync one document's points into Qdrant, incrementally and idempotently.

Per collection: read what Qdrant holds for the document (ids, `content_hash`, `model_id`),
then

* **delete** points whose source vanished (a re-parse dropped a block, an artifact was
  un-approved or superseded),
* **re-embed** only points that are new or whose content hash or `model_id` changed (a
  model swap is detected per point, so a migration is a filtered re-embed, not a wipe),
* **overwrite the payload** of unchanged points whose metadata moved (tags, heading),
* upsert in batches of 64 (the Qdrant guidance: 64-256 points per request, never one).

Docs: https://qdrant.tech/documentation/manage-data/points/ ·
model migration via a per-point model id: https://skills.qdrant.tech (qdrant-model-migration).
"""

import uuid
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from typing import Any

from qdrant_client import QdrantClient, models
from sqlmodel import Session

from app.db.session import release
from app.models import Document
from app.papers.claim_points import CLAIMS_AVG_LEN, claim_points
from app.pipeline.tree import Tree
from app.retrieval.client import Collection, collection_name, get_client
from app.retrieval.collections import DENSE, SPARSE, CollectionMismatchError, ensure_collections
from app.retrieval.embedding import Embedder
from app.retrieval.points import (
    BLOCKS_AVG_LEN,
    DISTILLATIONS_AVG_LEN,
    PointSpec,
    all_documents,
    approved_artifacts,
    block_points,
    distillation_points,
    document_payload,
)

BATCH = 64
_SCROLL_PAGE = 256


@dataclass(slots=True)
class SyncCounts:
    embedded: int = 0
    unchanged: int = 0
    payload_updated: int = 0
    deleted: int = 0


def _by_document(document_id: uuid.UUID | str) -> models.Filter:
    return models.Filter(
        must=[
            models.FieldCondition(
                key="document_id", match=models.MatchValue(value=str(document_id))
            )
        ]
    )


def existing_points(
    client: QdrantClient, name: str, document_id: uuid.UUID
) -> dict[str, dict[str, Any]]:
    """Every point of the document in `name`: id → payload."""
    found: dict[str, dict[str, Any]] = {}
    offset: models.ExtendedPointId | None = None
    while True:
        records, offset = client.scroll(
            name,
            scroll_filter=_by_document(document_id),
            limit=_SCROLL_PAGE,
            offset=offset,
            with_payload=True,
            with_vectors=False,
        )
        found.update({str(r.id): dict(r.payload or {}) for r in records})
        if offset is None:
            return found


def _upsert(
    client: QdrantClient,
    name: str,
    specs: Sequence[PointSpec],
    embedder: Embedder,
    avg_len: float,
) -> None:
    for start in range(0, len(specs), BATCH):
        batch = specs[start : start + BATCH]
        texts = [s.text for s in batch]
        dense = embedder.dense(texts)
        sparse = embedder.sparse(texts, avg_len=avg_len)
        client.upsert(
            name,
            points=[
                models.PointStruct(id=s.id, vector={DENSE: d, SPARSE: v}, payload=s.payload)
                for s, d, v in zip(batch, dense, sparse, strict=True)
            ],
            wait=True,
        )


def sync_points(
    client: QdrantClient,
    collection: Collection,
    document_id: uuid.UUID,
    specs: Sequence[PointSpec],
    *,
    embedder: Embedder,
    avg_len: float,
    force: bool = False,
) -> SyncCounts:
    """Make `collection` hold exactly `specs` for the document."""
    name = collection_name(collection)
    current = existing_points(client, name, document_id)
    counts = SyncCounts()
    wanted = {s.id for s in specs}
    stale: list[models.ExtendedPointId] = [pid for pid in current if pid not in wanted]
    if stale:
        client.delete(name, points_selector=models.PointIdsList(points=stale), wait=True)
        counts.deleted = len(stale)
    to_embed: list[PointSpec] = []
    for spec in specs:
        stored = current.get(spec.id)
        if (
            force
            or stored is None
            or stored.get("content_hash") != spec.content_hash
            or stored.get("model_id") != embedder.model_id
        ):
            to_embed.append(spec)
        elif stored != spec.payload:
            client.overwrite_payload(name, payload=spec.payload, points=[spec.id], wait=True)
            counts.payload_updated += 1
        else:
            counts.unchanged += 1
    _upsert(client, name, to_embed, embedder, avg_len)
    counts.embedded = len(to_embed)
    return counts


def _upsert_document(client: QdrantClient, document: Document) -> None:
    client.upsert(
        collection_name(Collection.DOCUMENTS),
        points=[
            models.PointStruct(id=str(document.id), vector={}, payload=document_payload(document))
        ],
        wait=True,
    )


def index_document(
    session: Session,
    document: Document,
    *,
    embedder: Embedder,
    client: QdrantClient | None = None,
    force: bool = False,
) -> dict[str, Any]:
    """Index one document: its blocks, its approved artifacts, its claims (papers), its
    metadata point.

    Assumes the collections exist (`ensure_collections`). Returns per-collection counts.
    """
    client = client or get_client()
    tree = Tree.load(session, document)
    blocks = block_points(tree, model_id=embedder.model_id)
    distillations = distillation_points(
        tree, approved_artifacts(session, document.id), model_id=embedder.model_id
    )
    claims = claim_points(session, document.id, model_id=embedder.model_id)  # papers only
    _upsert_document(client, document)
    document_id = document.id
    release(session)  # everything is read: no transaction open while embedding
    common: dict[str, Any] = {"embedder": embedder, "force": force}
    block_counts = sync_points(
        client, Collection.BLOCKS, document_id, blocks, avg_len=BLOCKS_AVG_LEN, **common
    )
    distillation_counts = sync_points(
        client,
        Collection.DISTILLATIONS,
        document_id,
        distillations,
        avg_len=DISTILLATIONS_AVG_LEN,
        **common,
    )
    claim_counts = sync_points(
        client, Collection.CLAIMS, document_id, claims, avg_len=CLAIMS_AVG_LEN, **common
    )
    return {
        "document_id": str(document_id),
        "model_id": embedder.model_id,
        "blocks": asdict(block_counts),
        "distillations": asdict(distillation_counts),
        "claims": asdict(claim_counts),
    }


def delete_document(client: QdrantClient, document_id: uuid.UUID | str) -> None:
    """Drop every point of a document from all three collections."""
    for collection in (Collection.BLOCKS, Collection.DISTILLATIONS):
        client.delete(
            collection_name(collection),
            points_selector=models.FilterSelector(filter=_by_document(document_id)),
            wait=True,
        )
    client.delete(
        collection_name(Collection.DOCUMENTS),
        points_selector=models.PointIdsList(points=[str(document_id)]),
        wait=True,
    )


def _indexed_document_ids(client: QdrantClient) -> set[str]:
    ids: set[str] = set()
    offset: models.ExtendedPointId | None = None
    while True:
        records, offset = client.scroll(
            collection_name(Collection.DOCUMENTS),
            limit=_SCROLL_PAGE,
            offset=offset,
            with_payload=False,
            with_vectors=False,
        )
        ids.update(str(r.id) for r in records)
        if offset is None:
            return ids


def rebuild_all(
    session: Session,
    *,
    embedder: Embedder,
    client: QdrantClient | None = None,
    force: bool = False,
) -> dict[str, Any]:
    """Re-derive the whole index from Postgres (D1). Idempotent; incremental unless `force`.

    `force` also recreates collections whose dense size no longer matches the embedder.
    Documents deleted from Postgres are removed from Qdrant.
    """
    client = client or get_client()
    try:
        report = ensure_collections(dense_dim=embedder.dense_dim, client=client)
    except CollectionMismatchError:
        if not force:
            raise
        report = ensure_collections(dense_dim=embedder.dense_dim, client=client, recreate=True)
    documents = list(all_documents(session))
    results = [
        index_document(session, d, embedder=embedder, client=client, force=force) for d in documents
    ]
    orphans = _indexed_document_ids(client) - {str(d.id) for d in documents}
    for orphan in sorted(orphans):
        delete_document(client, orphan)
    return {
        "collections_created": report.created,
        "documents": len(results),
        "orphans_removed": len(orphans),
        "embedded": sum(r["blocks"]["embedded"] + r["distillations"]["embedded"] for r in results),
        "deleted": sum(r["blocks"]["deleted"] + r["distillations"]["deleted"] for r in results),
    }

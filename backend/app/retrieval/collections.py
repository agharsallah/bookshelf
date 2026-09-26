"""The Qdrant layout of §10: `blocks`, `distillations`, `documents`, created idempotently.

Grounded in the current Qdrant guidance (loaded via the qdrant-advisor skill):

* Named vectors are declared at creation: dense `text` (cosine) + sparse `bm25` with the
  **IDF modifier**, which BM25 needs because IDF is computed server-side from collection
  statistics. https://qdrant.tech/documentation/search/text-search/ (BM25 section),
  https://qdrant.tech/documentation/concepts/hybrid-queries/
* **Payload indexes are created right after the collection, before any bulk upsert**, so
  they are built alongside HNSW rather than bolted on afterwards ("don't create payload
  indexes after HNSW builds"). https://qdrant.tech/documentation/manage-data/indexing/
* `documents` holds metadata only; its point id is the document id, which makes it the
  join target of `with_lookup` when grouping by `document_id`.
  https://qdrant.tech/documentation/concepts/search/#lookup-in-groups
* No quantization at this corpus size (D12); HNSW defaults (m=16, ef_construct=100).

A collection whose dense size no longer matches the embedder is a model change: pass
`recreate=True` (the rebuild job does) and re-index, since Qdrant is derived data (D1).
"""

import threading
import warnings
import weakref
from dataclasses import dataclass

from qdrant_client import QdrantClient, models

from app.retrieval.client import Collection, collection_name, get_client

DENSE = "text"
SPARSE = "bm25"

K = models.PayloadSchemaType.KEYWORD
INT = models.PayloadSchemaType.INTEGER

PAYLOAD_INDEXES: dict[Collection, dict[str, models.PayloadSchemaType]] = {
    Collection.BLOCKS: {
        "document_id": K,
        "anchor": K,
        "chapter_no": INT,
        "section_path": K,
        "kind": K,
        "tags": K,
        "model_id": K,
        "char_len": INT,  # the graph's semantic pass skips short blocks (app.graph.semantic)
    },
    Collection.DISTILLATIONS: {
        "document_id": K,
        "anchor": K,
        "type": K,
        "level": K,
        "tags": K,
        "review": K,
        "model_id": K,
    },
    Collection.DOCUMENTS: {"slug": K, "tags": K},
}

VECTOR_COLLECTIONS = (Collection.BLOCKS, Collection.DISTILLATIONS)


class CollectionMismatchError(RuntimeError):
    """An existing collection's vectors differ from the embedder's: rebuild needed."""


class QdrantUnavailableError(RuntimeError):
    """Qdrant cannot be opened or reached (server down, embedded store locked elsewhere)."""


@dataclass(frozen=True, slots=True)
class EnsureReport:
    created: list[str]
    existing: list[str]
    indexes: dict[str, list[str]]


def _vectors(collection: Collection, dense_dim: int) -> dict[str, models.VectorParams]:
    if collection not in VECTOR_COLLECTIONS:
        return {}
    return {DENSE: models.VectorParams(size=dense_dim, distance=models.Distance.COSINE)}


def _sparse(collection: Collection) -> dict[str, models.SparseVectorParams] | None:
    if collection not in VECTOR_COLLECTIONS:
        return None
    return {SPARSE: models.SparseVectorParams(modifier=models.Modifier.IDF)}


def _dense_size(client: QdrantClient, name: str) -> int | None:
    vectors = client.get_collection(name).config.params.vectors
    if isinstance(vectors, dict) and DENSE in vectors:
        return vectors[DENSE].size
    return None


def _create_indexes(client: QdrantClient, collection: Collection, name: str) -> list[str]:
    """Create every missing payload index. Returns the fields it (re)declared."""
    present = client.get_collection(name).payload_schema
    created = []
    with warnings.catch_warnings():
        # The embedded store ignores payload indexes (and says so); the server needs them.
        warnings.filterwarnings("ignore", message="Payload indexes have no effect")
        for field, schema in PAYLOAD_INDEXES[collection].items():
            if field in present:
                continue
            client.create_payload_index(name, field_name=field, field_schema=schema, wait=True)
            created.append(field)
    return created


def ensure_collections(
    *, dense_dim: int, client: QdrantClient | None = None, recreate: bool = False
) -> EnsureReport:
    """Create the three collections and their payload indexes if missing. Idempotent.

    Raises `CollectionMismatchError` when an existing vector collection has another dense
    size, unless `recreate=True`, which drops and recreates it (its points are lost).
    """
    client = client or get_client()
    created: list[str] = []
    existing: list[str] = []
    indexes: dict[str, list[str]] = {}
    for collection in Collection:
        name = collection_name(collection)
        if client.collection_exists(name):
            size = _dense_size(client, name)
            expected = dense_dim if collection in VECTOR_COLLECTIONS else None
            if size == expected:
                existing.append(name)
                indexes[name] = _create_indexes(client, collection, name)
                continue
            if not recreate:
                raise CollectionMismatchError(
                    f"Collection {name!r} has dense size {size}, the embedder needs "
                    f"{expected}. Rebuild with recreate=True."
                )
            client.delete_collection(name)
        client.create_collection(
            name,
            vectors_config=_vectors(collection, dense_dim),
            sparse_vectors_config=_sparse(collection),
        )
        created.append(name)
        indexes[name] = _create_indexes(client, collection, name)
    return EnsureReport(created=created, existing=existing, indexes=indexes)


_ready_lock = threading.Lock()
_ready: "weakref.WeakKeyDictionary[QdrantClient, int]" = weakref.WeakKeyDictionary()


def ensure_ready(client: QdrantClient, *, dense_dim: int) -> None:
    """`ensure_collections` once per client and dense size, on first use (never at startup).

    Raises `QdrantUnavailableError` when Qdrant cannot be reached, and lets
    `CollectionMismatchError` (a model change: rebuild) through unchanged.
    """
    with _ready_lock:
        if _ready.get(client) == dense_dim:
            return
        try:
            ensure_collections(dense_dim=dense_dim, client=client)
        except CollectionMismatchError:
            raise
        except Exception as exc:
            raise QdrantUnavailableError(f"Qdrant is unavailable: {exc}") from exc
        _ready[client] = dense_dim


def forget(client: QdrantClient) -> None:
    """Drop the `ensure_ready` memo for `client` (its collections vanished)."""
    with _ready_lock:
        _ready.pop(client, None)


def is_empty(client: QdrantClient) -> bool:
    """True when neither vector collection holds a point (nothing indexed yet)."""
    return all(client.count(collection_name(c), exact=False).count == 0 for c in VECTOR_COLLECTIONS)


def open_client() -> QdrantClient:
    """The shared client, or `QdrantUnavailableError` (e.g. another process holds the
    embedded store's lock)."""
    try:
        return get_client()
    except Exception as exc:
        raise QdrantUnavailableError(f"Qdrant cannot be opened: {exc}") from exc


def probe(client: QdrantClient) -> str | None:
    """None when Qdrant answers, else a short reason (for `/health/ready`)."""
    try:
        client.get_collections()
    except Exception as exc:
        return f"{type(exc).__name__}: {str(exc)[:200]}"
    return None

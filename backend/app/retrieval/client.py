"""The process-wide Qdrant client and the prefixed collection names.

`BOOKSHELF_QDRANT_URL` set → the remote cluster (with `BOOKSHELF_QDRANT_API_KEY`); unset →
the embedded on-disk store at `qdrant_path` (§18). Same code path either way.

The embedded store takes a file lock on its directory, so only one process can open it:
run the API and the worker against a server (Docker or Cloud) when both need vectors.

Tests swap the client with `set_client(QdrantClient(":memory:"))`.

Docs: https://qdrant.tech/documentation/quickstart/ (local mode: "QdrantClient(path=...)").
"""

import threading
from enum import StrEnum

from qdrant_client import QdrantClient

from app.core.config import get_settings


class Collection(StrEnum):
    """The three collections of §10. `name()` applies `qdrant_collection_prefix`."""

    BLOCKS = "blocks"
    DISTILLATIONS = "distillations"
    DOCUMENTS = "documents"


def collection_name(collection: Collection) -> str:
    return f"{get_settings().qdrant_collection_prefix}{collection.value}"


_lock = threading.Lock()
_client: QdrantClient | None = None


def make_client() -> QdrantClient:
    """A new client from settings: remote when a URL is configured, else embedded."""
    settings = get_settings()
    if settings.qdrant_url:
        return QdrantClient(url=settings.qdrant_url, api_key=settings.qdrant_api_key)
    settings.qdrant_path.mkdir(parents=True, exist_ok=True)
    return QdrantClient(path=str(settings.qdrant_path))


def get_client() -> QdrantClient:
    """The shared client, created on first use."""
    global _client
    with _lock:
        if _client is None:
            _client = make_client()
        return _client


def set_client(client: QdrantClient | None) -> None:
    """Replace the shared client (tests), or drop it with `None` so the next call rebuilds."""
    global _client
    with _lock:
        _client = client

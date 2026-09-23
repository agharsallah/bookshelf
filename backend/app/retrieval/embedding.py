"""The `Embedder` seam: dense + sparse (BM25) vectors and cross-encoder reranking.

`FastEmbedEmbedder` runs everything locally through FastEmbed (Q2: `bge-small-en-v1.5`,
`Qdrant/bm25`, `ms-marco-MiniLM-L-6-v2`). Models load lazily, once per process; the first
use downloads them (~0.16 GB total: 67 MB dense, 80 MB reranker, 10 MB BM25 stopwords).

BM25 notes from the Qdrant guidance (https://qdrant.tech/documentation/search/text-search/):
`avg_len` is not computed server-side, it is the client's job and must match the field
("short fields need a much smaller value or BM25 scoring is skewed"), so documents are
embedded with a per-collection `avg_len`; queries use `query_embed` (term weights of 1),
and the collection's IDF modifier supplies the inverse document frequency.

Reranking: https://qdrant.tech/documentation/fastembed/fastembed-rerankers/

`FakeEmbedder` is deterministic, offline and instant: hashed bag-of-words dense vectors
(texts sharing words are similar) and term-frequency sparse vectors. Tests only.
"""

import hashlib
import math
import re
import threading
from collections import Counter
from collections.abc import Sequence
from typing import TYPE_CHECKING, Any, Protocol

from qdrant_client import models

from app.core.config import get_settings

if TYPE_CHECKING:
    from fastembed import SparseTextEmbedding, TextEmbedding
    from fastembed.rerank.cross_encoder import TextCrossEncoder


class Embedder(Protocol):
    @property
    def model_id(self) -> str:
        """Identifies the dense + sparse models; stored on every point (model migration)."""
        ...

    @property
    def dense_dim(self) -> int: ...

    def dense(self, texts: Sequence[str]) -> list[list[float]]: ...

    def dense_query(self, text: str) -> list[float]: ...

    def sparse(self, texts: Sequence[str], *, avg_len: float) -> list[models.SparseVector]: ...

    def sparse_query(self, text: str) -> models.SparseVector: ...

    def rerank(self, query: str, docs: Sequence[str]) -> list[float]:
        """One relevance score per doc, higher is better."""
        ...


def _sparse_vector(embedding: Any) -> models.SparseVector:
    return models.SparseVector(
        indices=[int(i) for i in embedding.indices], values=[float(v) for v in embedding.values]
    )


class FastEmbedEmbedder:
    """FastEmbed models, loaded on first use and shared by every caller in the process."""

    def __init__(
        self,
        dense_model: str | None = None,
        sparse_model: str | None = None,
        rerank_model: str | None = None,
    ) -> None:
        settings = get_settings()
        self.dense_model = dense_model or settings.dense_model
        self.sparse_model = sparse_model or settings.sparse_model
        self.rerank_model = rerank_model or settings.rerank_model
        self._lock = threading.Lock()
        self._dense: TextEmbedding | None = None
        self._sparse: dict[float, SparseTextEmbedding] = {}
        self._reranker: TextCrossEncoder | None = None

    @property
    def model_id(self) -> str:
        return f"{self.dense_model}+{self.sparse_model}"

    @property
    def dense_dim(self) -> int:
        from fastembed import TextEmbedding

        return int(TextEmbedding.get_embedding_size(self.dense_model))

    def _dense_model(self) -> "TextEmbedding":
        with self._lock:
            if self._dense is None:
                from fastembed import TextEmbedding

                self._dense = TextEmbedding(self.dense_model)
            return self._dense

    def _sparse_model(self, avg_len: float) -> "SparseTextEmbedding":
        with self._lock:
            if avg_len not in self._sparse:
                from fastembed import SparseTextEmbedding

                self._sparse[avg_len] = SparseTextEmbedding(self.sparse_model, avg_len=avg_len)
            return self._sparse[avg_len]

    def _rerank_model(self) -> "TextCrossEncoder":
        with self._lock:
            if self._reranker is None:
                from fastembed.rerank.cross_encoder import TextCrossEncoder

                self._reranker = TextCrossEncoder(self.rerank_model)
            return self._reranker

    def dense(self, texts: Sequence[str]) -> list[list[float]]:
        return [[float(x) for x in vec] for vec in self._dense_model().embed(list(texts))]

    def dense_query(self, text: str) -> list[float]:
        return [float(x) for x in next(iter(self._dense_model().query_embed(text)))]

    def sparse(self, texts: Sequence[str], *, avg_len: float) -> list[models.SparseVector]:
        return [_sparse_vector(e) for e in self._sparse_model(avg_len).embed(list(texts))]

    def sparse_query(self, text: str) -> models.SparseVector:
        # Query weights do not depend on avg_len; any loaded instance will do.
        model = next(iter(self._sparse.values()), None) or self._sparse_model(256.0)
        return _sparse_vector(next(iter(model.query_embed(text))))

    def rerank(self, query: str, docs: Sequence[str]) -> list[float]:
        if not docs:
            return []
        return [float(s) for s in self._rerank_model().rerank(query, list(docs))]


# --- Test double -----------------------------------------------------------------------

_TOKEN = re.compile(r"[a-z0-9]+")
_STOP = frozenset(
    {"a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "is", "it", "of"}
    | {"on", "or", "that", "the", "to", "with"}
)


def tokens(text: str) -> list[str]:
    return [t for t in _TOKEN.findall(text.lower()) if t not in _STOP]


def _bucket(token: str, size: int) -> tuple[int, float]:
    digest = hashlib.blake2b(token.encode(), digest_size=8).digest()
    value = int.from_bytes(digest, "big")
    return value % size, 1.0 if value >> 63 else -1.0


class FakeEmbedder:
    """Deterministic, offline embeddings with the real dimension. Tests only."""

    def __init__(self, dim: int = 384, model_id: str = "fake-dense+fake-bm25") -> None:
        self._dim = dim
        self._model_id = model_id
        self.dense_calls: list[str] = []  # every text embedded, so tests can see re-embeds

    @property
    def model_id(self) -> str:
        return self._model_id

    @property
    def dense_dim(self) -> int:
        return self._dim

    def _vector(self, text: str) -> list[float]:
        vec = [0.0] * self._dim
        for token in tokens(text) or ["<empty>"]:
            index, sign = _bucket(token, self._dim)
            vec[index] += sign
        norm = math.sqrt(sum(x * x for x in vec)) or 1.0
        return [x / norm for x in vec]

    def dense(self, texts: Sequence[str]) -> list[list[float]]:
        self.dense_calls.extend(texts)
        return [self._vector(t) for t in texts]

    def dense_query(self, text: str) -> list[float]:
        return self._vector(text)

    def sparse(self, texts: Sequence[str], *, avg_len: float) -> list[models.SparseVector]:
        return [self._terms(Counter(tokens(t))) for t in texts]

    def sparse_query(self, text: str) -> models.SparseVector:
        return self._terms(Counter(set(tokens(text))))

    def _terms(self, counts: Counter[str]) -> models.SparseVector:
        weights: dict[int, float] = {}
        for token, count in counts.items():
            index = _bucket(token, 2**31 - 1)[0]
            weights[index] = weights.get(index, 0.0) + float(count)
        ordered = sorted(weights.items())
        return models.SparseVector(indices=[i for i, _ in ordered], values=[v for _, v in ordered])

    def rerank(self, query: str, docs: Sequence[str]) -> list[float]:
        wanted = set(tokens(query))
        return [len(wanted & set(tokens(d))) / (len(wanted) or 1) for d in docs]


# --- Process-wide instance -------------------------------------------------------------

_embedder: Embedder | None = None
_embedder_lock = threading.Lock()


def get_embedder() -> Embedder:
    """The shared embedder (FastEmbed unless a test installed another)."""
    global _embedder
    with _embedder_lock:
        if _embedder is None:
            _embedder = FastEmbedEmbedder()
        return _embedder


def set_embedder(embedder: Embedder | None) -> None:
    global _embedder
    with _embedder_lock:
        _embedder = embedder

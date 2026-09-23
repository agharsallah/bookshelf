"""Retrieval (§10): address before search, then two-tier hybrid search over Qdrant.

Postgres stays the source of truth (D1); every point in Qdrant is rebuilt from it by the
`embed` job. Modules, bottom up:

* `client`      QdrantClient factory (remote cluster, or the embedded on-disk store).
* `collections` the three collections and their payload indexes, created idempotently.
* `embedding`   the `Embedder` seam: FastEmbed in production, a deterministic fake in tests.
* `points`      nodes and approved artifacts → point payloads and texts.
* `indexing`    sync one document's points: re-embed only what changed, drop what vanished.
* `resolve`     deterministic (document, anchor) resolution with fuzzy title matching.
* `router`      intent classification: rules first, an optional cached model call, and a
                hard fallback to Discovery.
* `hybrid`      the vector tiers: distillations grouped by document, then evidence blocks.
* `lexical`     exact-phrase search over Postgres `nodes.tsv`.
* `search`      the entry point that routes a query and assembles grouped results.
* `answer`      cited answer synthesis through the `ModelRunner` seam.
"""

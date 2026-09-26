"""OpenAPI metadata: the description and tag copy shown in `/docs` and `/redoc`.

Docs: https://fastapi.tiangolo.com/tutorial/metadata/
"""

DESCRIPTION = """
Backend for **Bookshelf** - track reads, learnings, briefs, distillations, and search.

### Authentication
Read endpoints are open. Every write (`POST`, `PATCH`, `DELETE`) requires the
`X-API-Key` header. Use the **Authorize** button to set it for this page.

### Errors
Every failure returns the same envelope:

```json
{
  "error": {
    "code": "not_found",
    "message": "Document 3f1c… does not exist.",
    "details": [],
    "request_id": "8f14e45fceea167a5a36dedd4bea2543"
  }
}
```

`request_id` is also returned in the `X-Request-ID` header and is what to quote when
reporting a problem: it ties the response to the server log line.

### Limits
* Page size is capped (`limit`), and `total` is returned alongside every page.
* Requests are rate limited per client; exceeding it returns `429` with `Retry-After`.
* Request bodies above the configured size are rejected with `413`.
"""

TAGS_METADATA: list[dict[str, object]] = [
    {"name": "library", "description": "Files in `library/` waiting to be ingested."},
    {"name": "documents", "description": "Ingest by path, browse the tree, fix the outline."},
    {"name": "nodes", "description": "One block or subtree by its stable anchor."},
    {"name": "notes", "description": "Highlights and your notes. `raw` is never rewritten."},
    {"name": "reading", "description": "Where you are in each chapter; continue reading."},
    {"name": "artifacts", "description": "Summaries, distillations, briefs; review queue."},
    {"name": "jobs", "description": "The pipeline queue. Long work returns `202` + a job."},
    {"name": "search", "description": "Address-first, two-tier hybrid search with citations."},
    {"name": "concepts", "description": "Typeahead, concept pages with evidence, merges."},
    {"name": "graph", "description": "Concepts and evidence-backed edges, by neighborhood."},
    {"name": "exports", "description": "Markdown, JSON and CSV bundles per document."},
    {"name": "media", "description": "Derived images: figure and formula crops."},
    {"name": "audio", "description": "Audio summaries: voices, episodes, narrations."},
    {"name": "skills", "description": "Skill packages and interactive-mode inputs."},
    {
        "name": "health",
        "description": "Liveness and readiness probes for deployment tooling.",
    },
]

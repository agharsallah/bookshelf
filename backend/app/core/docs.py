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
    "message": "Book 42 does not exist.",
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
    {
        "name": "books",
        "description": "Create, browse, and curate the shelf.",
    },
    {
        "name": "health",
        "description": "Liveness and readiness probes for deployment tooling.",
    },
]

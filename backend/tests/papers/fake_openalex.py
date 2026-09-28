"""An in-memory OpenAlex for job tests, served through `httpx.MockTransport`.

It answers the calls `app.papers.openalex` makes, in the documented shapes: `/works/W…`,
`/works/doi:…`, and `/works?filter=` with `ids.openalex:` (OR), `cites:`
(+ `from_publication_date:`) and `locations.landing_page_url:`, plus `search=`.
Every request is recorded, so tests can assert what was asked.
"""

from collections.abc import Callable
from typing import Any

import httpx


def work_json(
    openalex_id: str,
    title: str,
    *,
    doi: str | None = None,
    year: int | None = 2020,
    publication_date: str | None = None,
    abstract: str | None = None,
    cited_by_count: int = 10,
    referenced_works: list[str] | None = None,
    related_works: list[str] | None = None,
    pdf_url: str | None = None,
    venue: str | None = None,
) -> dict[str, Any]:
    words = (abstract or "").split()
    return {
        "id": f"https://openalex.org/{openalex_id}",
        "doi": f"https://doi.org/{doi}" if doi else None,
        "display_name": title,
        "publication_year": year,
        "publication_date": publication_date or (f"{year}-01-01" if year else None),
        "authorships": [{"author": {"display_name": "Ada Lovelace"}}],
        "primary_location": {"source": {"display_name": venue}} if venue else None,
        "best_oa_location": {"pdf_url": pdf_url} if pdf_url else None,
        "locations": [],
        "abstract_inverted_index": {w: [i] for i, w in enumerate(words)} if words else None,
        "cited_by_count": cited_by_count,
        "topics": [{"display_name": "Machine Learning"}],
        "referenced_works": [f"https://openalex.org/{w}" for w in referenced_works or []],
        "related_works": [f"https://openalex.org/{w}" for w in related_works or []],
    }


class FakeOpenAlex:
    def __init__(self) -> None:
        self.works: dict[str, dict[str, Any]] = {}
        self.citing: dict[str, list[str]] = {}  # cited id → citing ids
        self.requests: list[httpx.Request] = []
        self.fallback: Callable[[httpx.Request], httpx.Response] | None = None

    def add(self, openalex_id: str, title: str, **kwargs: Any) -> dict[str, Any]:
        self.works[openalex_id] = work_json(openalex_id, title, **kwargs)
        return self.works[openalex_id]

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if request.url.host != "api.openalex.org":
            if self.fallback is not None:
                return self.fallback(request)
            return httpx.Response(404)
        path = request.url.path
        if path.startswith("/works/doi:"):
            doi = path.removeprefix("/works/doi:")
            found = [w for w in self.works.values() if w["doi"] == f"https://doi.org/{doi}"]
            return httpx.Response(200, json=found[0]) if found else httpx.Response(404)
        if path.startswith("/works/"):
            work = self.works.get(path.removeprefix("/works/"))
            return httpx.Response(200, json=work) if work else httpx.Response(404)
        return self._list(request)

    def _list(self, request: httpx.Request) -> httpx.Response:
        params = request.url.params
        if "search" in params:
            return _page([])
        clauses = dict(c.split(":", 1) for c in params.get("filter", "").split(",") if c)
        if "ids.openalex" in clauses:
            ids = clauses["ids.openalex"].split("|")
            return _page([self.works[i] for i in ids if i in self.works])
        if "cites" in clauses:
            since = clauses.get("from_publication_date", "")
            citers = [self.works[i] for i in self.citing.get(clauses["cites"], [])]
            return _page([w for w in citers if (w["publication_date"] or "") >= since])
        return _page([])

    def asked(self, fragment: str) -> list[httpx.Request]:
        return [r for r in self.requests if fragment in str(r.url)]


def _page(results: list[dict[str, Any]]) -> httpx.Response:
    return httpx.Response(200, json={"meta": {"count": len(results)}, "results": results})

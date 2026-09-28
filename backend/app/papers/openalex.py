"""A small typed OpenAlex client (docs/PAPERS.md §5, P7: fetched on demand, never crawled).

The `httpx.Client` is injected (production: `services.fetch.make_client()`, so the SSRF
guard and limits apply; tests: an `httpx.MockTransport`), and so is `sleep`, so a 429
test never waits.

    resolve(doi=, arxiv_id=, title=, year=)   DOI → arXiv → title search (+year)
    works_by_ids(ids)                         `filter=ids.openalex:W1|W2…`, 50 per call
    references(work) / related(work)          the work's `referenced_works` / `related_works`
    citing(id, since=)                        `filter=cites:W…,from_publication_date:…`

Lookups: `GET /works/W…` and `GET /works/doi:10.…` (404 → `OpenAlexNotFoundError`). An
arXiv paper has no arXiv key in `ids`, so it is found by its arXiv landing page
(`locations.landing_page_url`, OpenAlex stores the `http://` form) or its arXiv DOI.
A title search keeps a result only when its normalized title matches closely.

Failures are typed: 404 → `OpenAlexNotFoundError`; 429 → one retry after `Retry-After`
(capped at `max_retry_wait`; longer asks raise `OpenAlexRateLimitedError` at once);
timeouts, network errors and 5xx → `OpenAlexUnavailableError`; other 4xx → `OpenAlexError`.
All are `UpstreamError`s (502) unless noted, so the API renders them in the usual envelope.
"""

import logging
import time
from collections.abc import Callable, Iterable, Sequence
from datetime import date
from typing import Any

import httpx

from app.core.config import Settings
from app.papers.works import (
    TITLE_MATCH,
    WORK_FIELDS,
    Work,
    normalize_arxiv_id,
    normalize_doi,
    parse_work,
    short_openalex_id,
    title_similarity,
)
from app.services.errors import UpstreamError

logger = logging.getLogger(__name__)

DEFAULT_URL = "https://api.openalex.org"
BATCH_SIZE = 50  # ids per OR-filter call (OpenAlex allows 100 values; 50 keeps URLs short)
MAX_PER_PAGE = 100  # OpenAlex `per_page` ceiling
MAX_RETRY_WAIT_SECONDS = 10.0
DEFAULT_RETRY_WAIT_SECONDS = 1.0


class OpenAlexError(UpstreamError):
    """OpenAlex refused or failed a request."""

    code = "openalex_error"


class OpenAlexNotFoundError(OpenAlexError):
    status_code = 404
    code = "not_found"


class OpenAlexRateLimitedError(OpenAlexError):
    status_code = 503
    code = "rate_limited"

    def __init__(self, message: str, *, retry_after: float | None) -> None:
        super().__init__(message)
        self.retry_after = retry_after


class OpenAlexUnavailableError(OpenAlexError):
    """Timeout, network failure or a 5xx."""


class OpenAlex:
    def __init__(
        self,
        client: httpx.Client,
        *,
        base_url: str = DEFAULT_URL,
        mailto: str | None = None,
        api_key: str | None = None,
        sleep: Callable[[float], None] = time.sleep,
        max_retry_wait: float = MAX_RETRY_WAIT_SECONDS,
    ) -> None:
        self._client = client
        self._base = base_url.rstrip("/")
        self._auth = {k: v for k, v in (("mailto", mailto), ("api_key", api_key)) if v}
        self._sleep = sleep
        self._max_retry_wait = max_retry_wait

    @classmethod
    def from_settings(cls, client: httpx.Client, settings: Settings, **kwargs: Any) -> "OpenAlex":
        """Configured from `BOOKSHELF_OPENALEX_URL / _MAILTO / _API_KEY`."""
        return cls(
            client,
            base_url=settings.openalex_url,
            mailto=settings.openalex_mailto,
            api_key=settings.openalex_api_key,
            **kwargs,
        )

    # --- single works ---------------------------------------------------------------

    def work(self, openalex_id: str) -> Work:
        """One work by OpenAlex id (`W…` or its URL); `OpenAlexNotFoundError` when unknown."""
        return parse_work(self._get(f"/works/{short_openalex_id(openalex_id)}", {}))

    def by_doi(self, doi: str) -> Work | None:
        try:
            return parse_work(self._get(f"/works/doi:{normalize_doi(doi)}", {}))
        except OpenAlexNotFoundError:
            return None

    def by_arxiv(self, arxiv_id: str) -> Work | None:
        bare = normalize_arxiv_id(arxiv_id)
        pages = "|".join(f"{scheme}://arxiv.org/abs/{bare}" for scheme in ("http", "https"))
        found = self._list({"filter": f"locations.landing_page_url:{pages}", "per_page": 1})
        return found[0] if found else self.by_doi(f"10.48550/arxiv.{bare}")

    def search_title(self, title: str, year: int | None = None) -> Work | None:
        """The best search hit whose title matches `title` closely, or None."""
        params: dict[str, Any] = {"search": title, "per_page": 5}
        if year is not None:
            params["filter"] = f"publication_year:{year}"
        best: tuple[float, Work] | None = None
        for work in self._list(params):
            ratio = title_similarity(title, work.title)
            if ratio >= TITLE_MATCH and (best is None or ratio > best[0]):
                best = (ratio, work)
        return best[1] if best else None

    def resolve(
        self,
        *,
        doi: str | None = None,
        arxiv_id: str | None = None,
        title: str | None = None,
        year: int | None = None,
    ) -> Work | None:
        """The first of DOI, arXiv id, then title (+year) that finds the work."""
        if doi and (work := self.by_doi(doi)):
            return work
        if arxiv_id and (work := self.by_arxiv(arxiv_id)):
            return work
        if title and title.strip():
            return self.search_title(title, year)
        return None

    # --- lists ----------------------------------------------------------------------

    def works_by_ids(self, ids: Iterable[str]) -> list[Work]:
        """Works for `ids`, in input order, `BATCH_SIZE` per call; unknown ids are dropped."""
        wanted = list(dict.fromkeys(short_openalex_id(i) for i in ids))
        found: dict[str, Work] = {}
        for start in range(0, len(wanted), BATCH_SIZE):
            batch = wanted[start : start + BATCH_SIZE]
            params = {"filter": f"ids.openalex:{'|'.join(batch)}", "per_page": len(batch)}
            found.update((w.openalex_id, w) for w in self._list(params))
        return [found[i] for i in wanted if i in found]

    def references(self, work: Work) -> list[Work]:
        """The works `work` cites (OpenAlex `referenced_works`)."""
        return self.works_by_ids(work.referenced_works)

    def related(self, work: Work) -> list[Work]:
        """OpenAlex's `related_works` for `work`."""
        return self.works_by_ids(work.related_works)

    def citing(self, openalex_id: str, *, since: date | None = None, limit: int = 50) -> list[Work]:
        """Works citing `openalex_id`, newest first; `since` feeds the watch list."""
        clauses = [f"cites:{short_openalex_id(openalex_id)}"]
        if since is not None:
            clauses.append(f"from_publication_date:{since.isoformat()}")
        params = {
            "filter": ",".join(clauses),
            "sort": "publication_date:desc",
            "per_page": max(1, min(limit, MAX_PER_PAGE)),
        }
        return self._list(params)

    # --- transport ------------------------------------------------------------------

    def _list(self, params: dict[str, Any]) -> list[Work]:
        body = self._get("/works", params)
        return [parse_work(item) for item in body.get("results") or [] if isinstance(item, dict)]

    def _get(self, path: str, params: dict[str, Any]) -> dict[str, Any]:
        query = {**params, "select": ",".join(WORK_FIELDS), **self._auth}
        response = self._send(path, query)
        if response.status_code == 429:
            wait = _retry_after(response)
            if wait > self._max_retry_wait:
                raise _rate_limited(wait)
            logger.info("OpenAlex rate limit, retrying", extra={"wait_seconds": wait})
            self._sleep(wait)
            response = self._send(path, query)
            if response.status_code == 429:
                raise _rate_limited(_retry_after(response))
        if response.status_code == 404:
            raise OpenAlexNotFoundError(f"OpenAlex has no record at {path}.")
        if response.status_code >= 500:
            raise OpenAlexUnavailableError(f"OpenAlex answered {response.status_code}.")
        if response.status_code >= 400:
            raise OpenAlexError(f"OpenAlex refused the request ({response.status_code}).")
        try:
            body = response.json()
        except ValueError:
            raise OpenAlexUnavailableError("OpenAlex answered with invalid JSON.") from None
        if not isinstance(body, dict):
            raise OpenAlexUnavailableError("OpenAlex answered with an unexpected shape.")
        return body

    def _send(self, path: str, query: dict[str, Any]) -> httpx.Response:
        try:
            return self._client.get(
                f"{self._base}{path}", params=query, headers={"Accept": "application/json"}
            )
        except httpx.TimeoutException:
            raise OpenAlexUnavailableError("OpenAlex timed out.") from None
        except httpx.HTTPError as exc:
            raise OpenAlexUnavailableError(f"OpenAlex unreachable: {type(exc).__name__}.") from None


def _retry_after(response: httpx.Response) -> float:
    """Seconds to wait: the `Retry-After` header, else the body's `retryAfter`, else 1."""
    candidates: Sequence[object] = [response.headers.get("retry-after")]
    try:
        body = response.json()
        if isinstance(body, dict):
            candidates = [*candidates, body.get("retryAfter")]
    except ValueError:
        pass
    for value in candidates:
        if not isinstance(value, str | int | float):
            continue
        try:
            return max(0.0, float(value))
        except ValueError:  # an HTTP-date Retry-After: fall through to the default
            continue
    return DEFAULT_RETRY_WAIT_SECONDS


def _rate_limited(wait: float) -> OpenAlexRateLimitedError:
    return OpenAlexRateLimitedError(
        f"OpenAlex is rate limiting; retry in {wait:g}s.", retry_after=wait
    )

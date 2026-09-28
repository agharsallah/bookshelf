"""The outbound HTTP seam for paper jobs (OpenAlex, open-access PDFs).

Handlers call `http_client()`; production gets `services.fetch.make_client()` (SSRF guard on
every hop, timeouts, redirect cap), tests install a factory returning an `httpx.Client` over
an `httpx.MockTransport` with `set_http_client_factory`, so no job ever touches the network.
"""

from collections.abc import Callable, Iterator
from contextlib import contextmanager

import httpx

from app.core.config import get_settings
from app.papers.openalex import OpenAlex
from app.services import fetch

ClientFactory = Callable[[], httpx.Client]

_factory: ClientFactory | None = None


def set_http_client_factory(factory: ClientFactory | None) -> None:
    """Tests: route every paper job's HTTP through `factory`; `None` restores the default."""
    global _factory
    _factory = factory


@contextmanager
def http_client() -> Iterator[httpx.Client]:
    client = _factory() if _factory is not None else fetch.make_client()
    try:
        yield client
    finally:
        client.close()


def openalex(client: httpx.Client) -> OpenAlex:
    """An OpenAlex client configured from settings (`BOOKSHELF_OPENALEX_*`)."""
    return OpenAlex.from_settings(client, get_settings())

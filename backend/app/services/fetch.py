"""Fetch a web article for URL ingest, with hard limits on time, size and redirects.

SSRF guard: before every request, the first and each redirect hop (an httpx `request`
event hook), the host is resolved and refused if any of its addresses is loopback,
private, link-local, multicast, reserved or unspecified, IPv4 or IPv6, including
IPv4-mapped IPv6 (`::ffff:127.0.0.1`). An IP literal is checked as is.

The `httpx.Client` and the resolver are passed in, so tests inject an
`httpx.MockTransport` and a fake resolver and never touch the network
(`make_client(transport=..., resolver=...)`).
"""

import ipaddress
import socket
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date
from urllib.parse import urlsplit

import httpx

from app.services.errors import InvalidInputError, UpstreamError

TIMEOUT_SECONDS = 20.0
MAX_BYTES = 20 * 1024 * 1024
MAX_REDIRECTS = 5
USER_AGENT = "Bookshelf/0.1 (personal knowledge archive)"
_HTML_TYPES = ("text/html", "application/xhtml+xml")


@dataclass(frozen=True, slots=True)
class FetchedPage:
    url: str  # final URL after redirects
    content: bytes


@dataclass(frozen=True, slots=True)
class PageMetadata:
    title: str | None
    authors: list[str]
    year: int | None


Resolver = Callable[[str], list[str]]  # host → every address it resolves to


def system_resolver(host: str) -> list[str]:
    """All addresses the OS resolver returns for `host`."""
    try:
        infos = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except (socket.gaierror, UnicodeError):
        raise InvalidInputError(f"Cannot resolve {host}.", field="body.url") from None
    return sorted({str(info[4][0]) for info in infos})


def is_public_address(address: str) -> bool:
    """False for loopback, private, link-local, multicast, reserved, unspecified (and
    anything else not globally routable), looking through IPv4-mapped IPv6."""
    ip = ipaddress.ip_address(address.split("%", 1)[0])  # drop an IPv6 zone id
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    blocked = (
        ip.is_loopback
        or ip.is_private
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    )
    return ip.is_global and not blocked


def check_public_host(host: str, resolver: Resolver) -> None:
    """Refuse a host that is, or resolves to, a non-public address (`422`)."""
    try:
        addresses = [str(ipaddress.ip_address(host.strip("[]")))]
    except ValueError:
        addresses = resolver(host)
    if not addresses:
        raise InvalidInputError(f"Cannot resolve {host}.", field="body.url")
    if not all(is_public_address(a) for a in addresses):
        raise InvalidInputError(
            "URLs pointing at private, loopback or otherwise internal addresses are refused.",
            field="body.url",
        )


def make_client(
    transport: httpx.BaseTransport | None = None, *, resolver: Resolver = system_resolver
) -> httpx.Client:
    def guard(request: httpx.Request) -> None:  # runs for the first request and every hop
        check_public_host(request.url.host, resolver)

    return httpx.Client(
        timeout=TIMEOUT_SECONDS,
        follow_redirects=True,
        max_redirects=MAX_REDIRECTS,
        headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml"},
        transport=transport,
        event_hooks={"request": [guard]},
    )


def require_http_url(url: str) -> None:
    parts = urlsplit(url)
    if parts.scheme not in {"http", "https"} or not parts.hostname:
        raise InvalidInputError("Only absolute http(s) URLs can be ingested.", field="body.url")


def fetch_html(client: httpx.Client, url: str) -> FetchedPage:
    """GET `url` and return the HTML bytes, or raise a client-visible error.

    4xx, non-HTML and oversized responses are the caller's problem (`422`); network
    failures, timeouts and 5xx are the remote's (`502`).
    """
    require_http_url(url)
    try:
        with client.stream("GET", url) as response:
            _check_response(response)
            body = bytearray()
            for chunk in response.iter_bytes():
                body.extend(chunk)
                if len(body) > MAX_BYTES:
                    raise _too_large()
            return FetchedPage(url=str(response.url), content=bytes(body))
    except httpx.InvalidURL as exc:  # e.g. a host IDNA rejects, a control character
        raise InvalidInputError(f"Not a valid URL: {exc}", field="body.url") from None
    except httpx.TooManyRedirects:
        raise InvalidInputError(f"More than {MAX_REDIRECTS} redirects.", field="body.url") from None
    except httpx.TimeoutException:
        raise UpstreamError(f"Fetching the URL timed out after {TIMEOUT_SECONDS:g}s.") from None
    except httpx.HTTPError as exc:
        raise UpstreamError(f"Could not fetch the URL: {type(exc).__name__}.") from None


def _check_response(response: httpx.Response) -> None:
    if response.status_code >= 500:
        raise UpstreamError(f"The remote server answered {response.status_code}.")
    if response.status_code >= 400:
        raise InvalidInputError(f"The URL answered {response.status_code}.", field="body.url")
    content_type = response.headers.get("content-type", "").split(";")[0].strip().lower()
    if content_type and content_type not in _HTML_TYPES:
        raise InvalidInputError(f"Expected an HTML page, got {content_type}.", field="body.url")
    declared = response.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > MAX_BYTES:
        raise _too_large()


def _too_large() -> InvalidInputError:
    return InvalidInputError(
        f"The page is larger than {MAX_BYTES // (1024 * 1024)} MiB.", field="body.url"
    )


def page_metadata(html: bytes, url: str) -> PageMetadata:
    """Title, authors and year from the page's own metadata (trafilatura)."""
    # Imported lazily: trafilatura costs ~1 s at import time, paid only on URL ingest.
    from trafilatura.metadata import extract_metadata

    meta = extract_metadata(html.decode("utf-8", errors="replace"), default_url=url)
    authors = [a.strip() for a in (meta.author or "").split(";") if a.strip()]
    year: int | None = None
    if meta.date:
        try:
            year = date.fromisoformat(meta.date[:10]).year
        except ValueError:
            year = None
    title = (meta.title or "").strip() or None
    return PageMetadata(title=title[:500] if title else None, authors=authors, year=year)

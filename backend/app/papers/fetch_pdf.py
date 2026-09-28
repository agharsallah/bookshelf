"""Download an open-access paper PDF into the library (docs/PAPERS.md §5 "Add to shelf").

    arXiv id?  → https://arxiv.org/pdf/<id>   (preferred: stable, always a PDF)
    else / on failure → pdf_url (OpenAlex best_oa_location)
      → stream with a size cap → content-type is not HTML → body starts with %PDF-
      → library/papers/<slug>.pdf, never overwriting an existing file

Returns the `library/papers/<slug>.pdf` display path, which `services.ingest.ingest_path`
accepts as is. The client is injected: production passes `services.fetch.make_client()`
(SSRF guard on every hop, since `pdf_url` comes from third-party metadata); tests pass an
`httpx.MockTransport`.

The slug comes from the caller, normally `services.library.unique_slug(session, title,
is_taken=pdf_is_taken(library_dir))`, so it is free both in `documents` and on disk.
"""

import logging
import os
import tempfile
from collections.abc import Callable
from pathlib import Path

import httpx

from app.core.errors import ConflictError
from app.papers.works import arxiv_pdf_url
from app.services import library
from app.services.errors import InvalidInputError, UpstreamError

logger = logging.getLogger(__name__)

PAPERS_SUBDIR = "papers"
MAX_PDF_BYTES = 50 * 1024 * 1024
_MAGIC = b"%PDF-"
_MAGIC_WINDOW = 1024  # the PDF spec lets the header sit anywhere in the first KiB
_REFUSED_TYPES = ("text/html", "application/xhtml+xml", "text/plain", "application/json")


class NotAPdfError(InvalidInputError):
    """The URL served something that is not a PDF (an HTML landing page, usually)."""


class PdfTooLargeError(InvalidInputError):
    """The PDF is larger than the cap."""


class PdfUnavailableError(UpstreamError):
    """No source to try, or every source failed (network, timeout, HTTP error)."""


def target_path(library_dir: Path, slug: str) -> Path:
    return library_dir.resolve() / PAPERS_SUBDIR / f"{slug}.pdf"


def pdf_is_taken(library_dir: Path) -> Callable[[str], bool]:
    """`is_taken` for `unique_slug`: a slug is taken when its PDF already exists."""
    return lambda slug: target_path(library_dir, slug).exists()


def pdf_sources(*, arxiv_id: str | None, pdf_url: str | None) -> list[str]:
    """URLs to try, in order: arXiv first, then the open-access URL (deduplicated)."""
    urls = [arxiv_pdf_url(arxiv_id)] if arxiv_id else []
    if pdf_url and pdf_url.startswith(("http://", "https://")):
        urls.append(pdf_url)
    return list(dict.fromkeys(urls))


def fetch_pdf(
    client: httpx.Client,
    library_dir: Path,
    *,
    slug: str,
    arxiv_id: str | None = None,
    pdf_url: str | None = None,
    max_bytes: int = MAX_PDF_BYTES,
) -> str:
    """Download the paper to `library/papers/<slug>.pdf`; return that display path."""
    if library.slugify(slug) != slug:
        raise InvalidInputError(f"Not a valid slug: {slug!r}", field="slug")
    target = target_path(library_dir, slug)
    if target.exists():
        raise ConflictError(f"{library.display_path(library_dir, target)} already exists.")
    urls = pdf_sources(arxiv_id=arxiv_id, pdf_url=pdf_url)
    if not urls:
        raise PdfUnavailableError("This paper has no open-access PDF.")
    failure: Exception = PdfUnavailableError("No PDF source answered.")
    for url in urls:
        try:
            content = download(client, url, max_bytes=max_bytes)
        # InvalidInputError also covers the SSRF guard refusing (or failing to resolve) a
        # host: one bad source must not keep the next one from being tried.
        except (InvalidInputError, PdfUnavailableError) as exc:
            logger.info("PDF source failed", extra={"url": url, "error": str(exc)})
            failure = exc
            continue
        _write_new(target, content)
        return library.display_path(library_dir, target)
    raise failure  # the last source's error: the most specific reason we have


def download(client: httpx.Client, url: str, *, max_bytes: int = MAX_PDF_BYTES) -> bytes:
    """GET `url` and return its bytes if, and only if, it is a PDF within `max_bytes`."""
    try:
        with client.stream("GET", url, headers={"Accept": "application/pdf"}) as response:
            if response.status_code >= 400:
                raise PdfUnavailableError(f"{url} answered {response.status_code}.")
            content_type = response.headers.get("content-type", "").split(";")[0].strip().lower()
            if content_type in _REFUSED_TYPES:
                raise NotAPdfError(f"{url} served {content_type}, not a PDF.")
            declared = response.headers.get("content-length", "")
            if declared.isdigit() and int(declared) > max_bytes:
                raise _too_large(max_bytes)
            body = bytearray()
            for chunk in response.iter_bytes():
                body.extend(chunk)
                if len(body) > max_bytes:
                    raise _too_large(max_bytes)
    except httpx.TimeoutException:
        raise PdfUnavailableError(f"Downloading {url} timed out.") from None
    except httpx.HTTPError as exc:
        raise PdfUnavailableError(f"Could not download {url}: {type(exc).__name__}.") from None
    if _MAGIC not in bytes(body[:_MAGIC_WINDOW]):
        raise NotAPdfError(f"{url} did not return a PDF.")
    return bytes(body)


def _write_new(target: Path, content: bytes) -> None:
    """Write via a temp file, then hard-link into place: fails, not clobbers, if it exists."""
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=target.parent, prefix=".tmp-", suffix=".pdf")
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(content)
        os.link(tmp, target)
    except FileExistsError:
        raise ConflictError(f"{target.name} already exists.") from None
    finally:
        Path(tmp).unlink(missing_ok=True)


def _too_large(max_bytes: int) -> PdfTooLargeError:
    return PdfTooLargeError(f"The PDF is larger than {max_bytes // (1024 * 1024)} MiB.")

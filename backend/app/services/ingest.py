"""Register a new document from a library file or a URL and queue its parse (§7 stage 1).

Both paths end the same way: sha256 dedupe, a unique slug, one `documents` row and a
`parse` job committed in the same transaction.
"""

from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.core.errors import ConflictError
from app.jobs.queue import JobSpec
from app.models import Document, Job
from app.models.enums import DocumentKind, JobKind
from app.services import fetch, library
from app.services.files import write_atomic
from app.services.jobs import enqueue_or_live

ARTICLES_SUBDIR = "articles"


@dataclass(frozen=True, slots=True)
class IngestMetadata:
    """Caller-supplied metadata; `None` means "work it out from the source"."""

    title: str | None = None
    authors: list[str] | None = None
    year: int | None = None
    tags: list[str] | None = None


def ingest_path(
    session: Session, library_dir: Path, raw_path: str, meta: IngestMetadata
) -> tuple[Document, Job]:
    """Register a file that is already inside `library_dir`."""
    file = library.resolve_library_file(library_dir, raw_path)
    sha = library.sha256_file(file)
    _reject_duplicate(session, sha)
    title = meta.title or library.title_from_filename(file)
    document = Document(
        kind=library.kind_for(file),
        slug=library.unique_slug(session, title),
        title=title,
        authors=meta.authors or [],
        year=meta.year,
        tags=_tags(meta.tags),
        source_path=library.display_path(library_dir, file),
        sha256=sha,
    )
    return _register(session, document)


def ingest_url(
    session: Session, library_dir: Path, client: httpx.Client, url: str, meta: IngestMetadata
) -> tuple[Document, Job]:
    """Fetch an article, keep the original HTML under `library/articles/` (D13), register it."""
    page = fetch.fetch_html(client, url)
    sha = library.sha256_bytes(page.content)
    _reject_duplicate(session, sha)
    found = fetch.page_metadata(page.content, page.url)
    title = meta.title or found.title or _title_from_url(page.url)
    articles = library_dir.resolve() / ARTICLES_SUBDIR

    def file_is_taken(slug: str) -> bool:
        existing = articles / f"{slug}.html"
        return existing.exists() and library.sha256_file(existing) != sha

    slug = library.unique_slug(session, title, is_taken=file_is_taken)
    target = articles / f"{slug}.html"
    if not target.exists():
        write_atomic(target, page.content)
    document = Document(
        kind=DocumentKind.ARTICLE,
        slug=slug,
        title=title,
        authors=meta.authors if meta.authors is not None else found.authors,
        year=meta.year if meta.year is not None else found.year,
        tags=_tags(meta.tags),
        source_uri=url,
        source_path=library.display_path(library_dir, target),
        sha256=sha,
        meta={"final_url": page.url} if page.url != url else {},
    )
    return _register(session, document)


def _reject_duplicate(session: Session, sha: str) -> None:
    existing = session.exec(select(Document).where(Document.sha256 == sha)).first()
    if existing is not None:
        raise ConflictError(
            f"This content is already ingested as '{existing.slug}'.",
            details=[{"document_id": str(existing.id), "slug": existing.slug}],
        )


def _register(session: Session, document: Document) -> tuple[Document, Job]:
    session.add(document)
    try:
        session.flush()
    except IntegrityError:  # lost a race on sha256 or slug with a concurrent ingest
        session.rollback()
        _reject_duplicate(session, document.sha256)
        raise ConflictError("A document with this slug was just created; retry.") from None
    job, _ = enqueue_or_live(session, JobSpec(kind=JobKind.PARSE, document_id=document.id))
    session.refresh(document)
    return document, job


def _tags(tags: list[str] | None) -> list[str]:
    return list(dict.fromkeys(tags or []))


def _title_from_url(url: str) -> str:
    parts = urlsplit(url)
    tail = parts.path.rstrip("/").rsplit("/", 1)[-1]
    return library.title_from_filename(Path(tail)) if tail else parts.hostname or url

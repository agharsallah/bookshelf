"""A build's references (docs/BUILDS.md B13, §7): what to suggest, how they are written down,
and the snapshots the runner takes so the agent can read a page without the network.

    suggested_references(session, doc)   one-click chips: the paper's code and data links,
                                         its own arXiv / DOI page, up to 10 cited works with
                                         an arXiv id or DOI, and the cited papers on the shelf
    reference_path(n, ref)               docs/references/NN-<slug>.md for a snapshot or a
                                         shelf paper's brief, else None
    render_references_md(refs, ...)      docs/REFERENCES.md: title, link, note, its file
    snapshot(ref, path, fetch=...)       the page's readable text, or the error (never raises)

The fetcher is injected (`Fetch`: url → `FetchedText`); the default goes through
`app.services.fetch` (SSRF guard, limits) and trafilatura. Tests never touch the network.
"""

import re
import unicodedata
import uuid
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal
from urllib.parse import urlsplit

from sqlmodel import Session, col, select

from app.models import Document, PaperMeta, PaperReference
from app.schemas.build_options import BuildReference

MAX_CITED = 10
MAX_SNAPSHOT_CHARS = 200_000
REFERENCES_DIR = "docs/references"
Source = Literal["code", "data", "paper", "cited", "shelf"]


@dataclass(frozen=True, slots=True)
class Suggestion:
    kind: Literal["url", "shelf"]
    url: str | None
    document_id: uuid.UUID | None
    title: str
    source: Source


@dataclass(frozen=True, slots=True)
class FetchedText:
    url: str  # after redirects
    title: str | None
    text: str  # readable Markdown


@dataclass(frozen=True, slots=True)
class SnapshotResult:
    path: str
    content: str | None  # the file to write; None when the fetch failed
    error: str | None = None


Fetch = Callable[[str], FetchedText]


# --- suggestions --------------------------------------------------------------------------


def _url_title(url: str, prefix: str) -> str:
    parts = urlsplit(url)
    where = f"{parts.netloc}{parts.path}".rstrip("/") or url
    return f"{prefix}: {where}"[:200]


def _paper_links(meta: PaperMeta | None) -> list[tuple[str, str]]:
    if meta is None:
        return []
    out = []
    if meta.arxiv_id:
        out.append(("arXiv", f"https://arxiv.org/abs/{meta.arxiv_id}"))
    if meta.doi:
        out.append(("DOI", f"https://doi.org/{meta.doi}"))
    return out


def _cited_url(ref: PaperReference) -> str | None:
    if ref.arxiv_id:
        return f"https://arxiv.org/abs/{ref.arxiv_id}"
    return f"https://doi.org/{ref.doi}" if ref.doi else None


def suggested_references(session: Session, document: Document) -> list[Suggestion]:
    """The chips a form offers, deduplicated by url and by paper. A cited work that is on
    the shelf is offered as a `shelf` reference (its brief), not as its link."""
    meta = session.get(PaperMeta, document.id)
    out: list[Suggestion] = []
    for url in meta.code_urls if meta else []:
        out.append(Suggestion("url", url, None, _url_title(url, "Code"), "code"))
    for url in meta.data_urls if meta else []:
        out.append(Suggestion("url", url, None, _url_title(url, "Data"), "data"))
    for label, url in _paper_links(meta):
        out.append(Suggestion("url", url, None, f"{document.title} ({label})"[:200], "paper"))
    refs = session.exec(
        select(PaperReference)
        .where(PaperReference.document_id == document.id)
        .order_by(col(PaperReference.ordinal))
    ).all()
    on_shelf = [r.target_document_id for r in refs if r.target_document_id is not None]
    titles = dict(
        session.exec(
            select(Document.id, Document.title).where(col(Document.id).in_(on_shelf))
        ).all()
    ) if on_shelf else {}  # fmt: skip
    cited = 0
    for ref in refs:
        target = ref.target_document_id
        if target is not None and target != document.id and target in titles:
            out.append(Suggestion("shelf", None, target, titles[target][:200], "shelf"))
        elif cited < MAX_CITED and (link := _cited_url(ref)):
            title = (ref.title or ref.raw or link).strip()[:200]
            out.append(Suggestion("url", link, None, title, "cited"))
            cited += 1
    return _dedupe(out)


def _dedupe(items: Iterable[Suggestion]) -> list[Suggestion]:
    seen: set[str] = set()
    out = []
    for item in items:
        key = item.url.rstrip("/").lower() if item.url else f"doc:{item.document_id}"
        if key not in seen:
            seen.add(key)
            out.append(item)
    return out


# --- files --------------------------------------------------------------------------------


def slugify(text: str, limit: int = 50) -> str:
    ascii_ = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_.lower()).strip("-")
    return slug[:limit].rstrip("-") or "reference"


def reference_path(number: int, ref: BuildReference) -> str | None:
    """Where reference `number` (1-based) is written: a snapshot or a shelf brief."""
    if ref.kind == "shelf" or ref.snapshot:
        return f"{REFERENCES_DIR}/{number:02d}-{slugify(ref.title)}.md"
    return None


def render_references_md(
    refs: Sequence[BuildReference],
    shelf_titles: Mapping[uuid.UUID, str],
    files: Mapping[int, str] | None = None,
) -> str:
    """docs/REFERENCES.md. `files` maps a 1-based number to the file written for it (a
    snapshot, a shelf brief); a reference without one is a link only."""
    files = files or {}
    lines = [
        "# References",
        "",
        "Material the reader chose for this build. A file under `docs/references/` holds",
        "the text itself; a reference without one is a name and a link only.",
        "",
    ]
    for number, ref in enumerate(refs, 1):
        if ref.kind == "url":
            head = f"{number}. **[{ref.title}]({ref.url})**"
        else:
            shelf = shelf_titles.get(ref.document_id) if ref.document_id else None
            extra = f" (the paper *{shelf}*)" if shelf and shelf != ref.title else ""
            head = f"{number}. **{ref.title}**{extra}, a paper from the reader's shelf"
        lines.append(head)
        if ref.note:
            lines.append(f"   - Why: {ref.note.strip()}")
        if path := files.get(number):
            label = "snapshot" if ref.kind == "url" else "brief"
            lines.append(f"   - {label}: [{path}]({path.removeprefix('docs/')})")
    return "\n".join(lines).rstrip() + "\n"


# --- snapshots ----------------------------------------------------------------------------


def fetch_readable(url: str) -> FetchedText:
    """The default fetcher: `services.fetch` (guarded, bounded), then trafilatura's text."""
    # Imported lazily: trafilatura costs ~1 s at import time, paid only when a build seeds.
    import trafilatura

    from app.services.fetch import fetch_html, make_client, page_metadata

    with make_client() as client:
        page = fetch_html(client, url)
    html = page.content.decode("utf-8", errors="replace")
    text = trafilatura.extract(html, url=page.url, output_format="markdown",
                               include_links=True, include_tables=True)  # fmt: skip
    if not text:
        raise ValueError("no readable text on the page")
    return FetchedText(url=page.url, title=page_metadata(page.content, page.url).title, text=text)


def snapshot(
    ref: BuildReference, path: str, *, fetch: Fetch = fetch_readable, now: datetime | None = None
) -> SnapshotResult:
    """Fetch `ref.url` into the file at `path`. A failure is returned, never raised: the
    reference then stays a link (B13)."""
    try:
        page = fetch(str(ref.url))
    except Exception as exc:  # any fetch failure leaves a link-only reference
        return SnapshotResult(path=path, content=None, error=str(exc)[:300] or type(exc).__name__)
    when = (now or datetime.now(UTC)).date().isoformat()
    text = page.text.strip()
    if len(text) > MAX_SNAPSHOT_CHARS:
        text = text[:MAX_SNAPSHOT_CHARS].rsplit("\n", 1)[0] + "\n\n[… truncated]"
    lines = [f"# {ref.title}", "", f"Source: <{page.url}> · fetched {when}"]
    if ref.note:
        lines += ["", f"> {ref.note.strip()}"]
    content = "\n".join([*lines, "", "---", "", text]) + "\n"
    return SnapshotResult(path=path, content=content)


def pending_snapshot(ref: BuildReference) -> str:
    """What a preview shows for a snapshot not fetched yet."""
    return (
        f"# {ref.title}\n\nSource: <{ref.url}>\n\n"
        "_Fetched when the build starts; if the fetch fails this reference stays a link._\n"
    )

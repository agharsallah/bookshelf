"""The `library/` folder (D13): safe path resolution, content hashing, slugs.

Originals are ingested by path and never mutated or deleted. A document's
`source_path` is stored relative to the library's parent (`library/x.pdf`), so the
same row resolves on any machine that checks out the repo; `resolve_source_path`
turns it back into a file.
"""

import hashlib
import re
import threading
import unicodedata
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import or_
from sqlmodel import Session, col, select

from app.models import Document
from app.models.enums import DocumentKind
from app.services.errors import InvalidInputError

SUPPORTED_SUFFIXES: dict[str, DocumentKind] = {
    ".pdf": DocumentKind.PDF,
    ".html": DocumentKind.ARTICLE,
    ".htm": DocumentKind.ARTICLE,
    ".md": DocumentKind.ARTICLE,
}
SLUG_MAX_LENGTH = 80
_CHUNK = 1024 * 1024


# --- paths --------------------------------------------------------------------


def display_path(library_dir: Path, file: Path) -> str:
    """`library/sub/x.pdf`: the form stored in `documents.source_path`."""
    root = library_dir.resolve()
    return (Path(root.name) / file.resolve().relative_to(root)).as_posix()


class SourcePathError(ValueError):
    """A stored `source_path` is missing or points outside the repository."""


def resolve_source_path(library_dir: Path, source_path: str | None) -> Path:
    """Inverse of `display_path`: the file a stored `source_path` points at.

    The one repo-escape check for stored paths: raises `SourcePathError` for a missing
    path or one that resolves (symlinks included) outside the library's parent.
    """
    if not source_path:
        raise SourcePathError("document has no source file")
    root = library_dir.resolve().parent
    path = (root / source_path).resolve()
    if not path.is_relative_to(root):
        raise SourcePathError(f"source path escapes the repository: {source_path}")
    return path


def resolve_library_file(library_dir: Path, raw: str) -> Path:
    """Resolve a client-supplied path to a supported file strictly inside `library_dir`.

    Accepts `library/x.pdf` (as `GET /library` lists it) or `x.pdf` relative to the
    library. Symlinks are followed *before* the containment check, so a link that
    points outside the library is rejected like `../` is.
    """
    root = library_dir.resolve()
    candidate = Path(raw)
    if candidate.is_absolute():
        raise InvalidInputError("Path must be relative to the library.", field="body.path")
    if candidate.parts and candidate.parts[0] == root.name:
        candidate = Path(*candidate.parts[1:])
    try:
        resolved = (root / candidate).resolve(strict=True)
    except (OSError, RuntimeError, ValueError):  # ValueError: a NUL byte in the path
        raise InvalidInputError(f"No such file in the library: {raw}", field="body.path") from None
    if not resolved.is_relative_to(root) or resolved == root:
        raise InvalidInputError("Path escapes the library directory.", field="body.path")
    if not resolved.is_file():
        raise InvalidInputError(f"Not a regular file: {raw}", field="body.path")
    if resolved.suffix.lower() not in SUPPORTED_SUFFIXES:
        allowed = ", ".join(sorted(SUPPORTED_SUFFIXES))
        raise InvalidInputError(f"Unsupported file type (allowed: {allowed}).", field="body.path")
    return resolved


def kind_for(path: Path) -> DocumentKind:
    return SUPPORTED_SUFFIXES[path.suffix.lower()]


# --- hashing ------------------------------------------------------------------

_hash_cache: dict[tuple[str, int, int], str] = {}
_hash_lock = threading.Lock()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    """sha256 of a file, cached in-process by (path, size, mtime) so rescans are cheap."""
    stat = path.stat()
    key = (str(path), stat.st_size, stat.st_mtime_ns)
    with _hash_lock:
        cached = _hash_cache.get(key)
    if cached is not None:
        return cached
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(_CHUNK):
            digest.update(chunk)
    value = digest.hexdigest()
    with _hash_lock:
        _hash_cache[key] = value
    return value


# --- slugs and titles -----------------------------------------------------------


def slugify(text: str) -> str:
    """Kebab-case ASCII slug matching the `documents.slug` check constraint."""
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_text.lower()).strip("-")
    slug = slug[:SLUG_MAX_LENGTH].rstrip("-")
    return slug or "document"


def title_from_filename(path: Path) -> str:
    words = re.sub(r"[-_.]+", " ", path.stem).split()
    return " ".join(w if w.isupper() else w.capitalize() for w in words) or path.stem


def free_slug(base: str, is_taken: Callable[[str], bool]) -> str:
    """The first of `base`, `base-2`, `base-3`, ... that is not taken."""
    candidate, n = base, 1
    while is_taken(candidate):
        n += 1
        candidate = f"{base[: SLUG_MAX_LENGTH - len(str(n)) - 1].rstrip('-')}-{n}"
    return candidate


def unique_slug(
    session: Session, text: str, *, is_taken: Callable[[str], bool] | None = None
) -> str:
    """`slugify(text)`, suffixed until no document (and not `is_taken`) has it."""
    base = slugify(text)
    # Slugs are [a-z0-9-] only, so the LIKE pattern needs no escaping.
    existing = set(
        session.exec(
            select(Document.slug).where(
                or_(col(Document.slug) == base, col(Document.slug).like(f"{base}-%"))
            )
        )
    )
    return free_slug(base, lambda s: s in existing or (is_taken is not None and is_taken(s)))


# --- scanning -------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class LibraryFile:
    path: str
    size: int
    modified_at: datetime
    kind: DocumentKind
    sha256: str
    suggested_title: str
    suggested_slug: str


def _supported_files(root: Path) -> Iterable[Path]:
    for file in sorted(root.rglob("*")):
        relative = file.relative_to(root)
        if any(part.startswith(".") for part in relative.parts):
            continue
        if file.suffix.lower() not in SUPPORTED_SUFFIXES or not file.is_file():
            continue
        if not file.resolve().is_relative_to(root):  # symlink pointing outside
            continue
        yield file


def pending_files(session: Session, library_dir: Path) -> list[LibraryFile]:
    """Supported files under `library_dir` whose content is not yet a document."""
    root = library_dir.resolve()
    if not root.is_dir():
        return []
    files = [(f, sha256_file(f)) for f in _supported_files(root)]
    hashes = {digest for _, digest in files}
    ingested = (
        set(session.exec(select(Document.sha256).where(col(Document.sha256).in_(hashes))))
        if hashes
        else set()
    )
    pending: list[LibraryFile] = []
    taken = set(session.exec(select(Document.slug)))  # one query, not one per file
    for file, digest in files:
        if digest in ingested:
            continue
        ingested.add(digest)  # the same bytes twice in the folder: list it once
        title = title_from_filename(file)
        slug = free_slug(slugify(title), taken.__contains__)
        taken.add(slug)
        stat = file.stat()
        pending.append(
            LibraryFile(
                path=display_path(root, file),
                size=stat.st_size,
                modified_at=datetime.fromtimestamp(stat.st_mtime, tz=UTC),
                kind=kind_for(file),
                sha256=digest,
                suggested_title=title,
                suggested_slug=slug,
            )
        )
    return pending

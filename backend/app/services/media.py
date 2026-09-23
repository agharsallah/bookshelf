"""Derived media (figure crops, rendered pages) under `settings.media_dir`."""

from collections.abc import Iterable
from pathlib import Path

from app.core.errors import NotFoundError

# Raster images only: SVG can carry script and is never produced by the parser.
IMAGE_TYPES: dict[str, str] = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
}


def resolve_media_file(media_dir: Path, raw: str) -> tuple[Path, str]:
    """Resolve `raw` to an image strictly inside `media_dir`, with its media type.

    Anything else (traversal, symlink escape, absolute path, directory, non-image, missing)
    is a plain 404, so the endpoint never confirms what exists outside the media folder.
    """
    root = media_dir.resolve()
    missing = NotFoundError("No such media file.")
    if not raw or Path(raw).is_absolute() or "\x00" in raw:
        raise missing
    try:
        resolved = (root / raw).resolve(strict=True)
    except (OSError, RuntimeError):
        raise missing from None
    media_type = IMAGE_TYPES.get(resolved.suffix.lower())
    if not resolved.is_relative_to(root) or not resolved.is_file() or media_type is None:
        raise missing
    return resolved, media_type


def prune_document_media(media_dir: Path, slug: str, referenced: Iterable[str]) -> list[str]:
    """Delete files under `media_dir/<slug>/` that no node references any more (stale
    crops after a re-parse), then empty folders. `referenced` are media-relative paths
    (`<slug>/ch01/f001.png`, as in `nodes.meta.image_path`). Returns what was deleted.

    Nothing outside the document's own folder is ever touched.
    """
    root = media_dir.resolve()
    folder = (root / slug).resolve()
    if not slug or not folder.is_relative_to(root) or folder == root or not folder.is_dir():
        return []
    keep = {(root / path).resolve() for path in referenced}
    deleted: list[str] = []
    for file in sorted(folder.rglob("*")):
        if (file.is_file() or file.is_symlink()) and file.resolve() not in keep:
            file.unlink()
            deleted.append(file.relative_to(root).as_posix())
    for directory in sorted((d for d in folder.rglob("*") if d.is_dir()), reverse=True):
        if not any(directory.iterdir()):
            directory.rmdir()
    return deleted

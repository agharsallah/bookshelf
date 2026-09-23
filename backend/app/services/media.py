"""Derived media (figure crops, rendered pages) under `settings.media_dir`."""

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

"""Filesystem helpers for derived and fetched files."""

import os
import tempfile
from pathlib import Path


def write_atomic(target: Path, content: bytes) -> None:
    """Write `content` to `target` via a temp file + rename, so readers never see half a file."""
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=target.parent, prefix=".tmp-", suffix=target.suffix)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(content)
        Path(tmp).replace(target)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise

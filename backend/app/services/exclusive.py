"""One long operation on the whole library at a time (Settings → Database).

A sync, a switch, a snapshot and a restore each read or replace every row; two at once
would read a half-written database or write over each other. They claim this first.
"""

import threading
from functools import lru_cache

from app.core.errors import ConflictError


class Exclusive:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._holder: str | None = None

    def claim(self, what: str) -> None:
        """Hold it for `what` ("A sync", "A restore"…). Raises `ConflictError` naming the
        operation already holding it."""
        with self._lock:
            if self._holder is not None:
                raise ConflictError(f"{self._holder} is running; wait for it to finish.")
            self._holder = what

    def release(self) -> None:
        with self._lock:
            self._holder = None

    @property
    def holder(self) -> str | None:
        with self._lock:
            return self._holder


@lru_cache
def process_wide() -> Exclusive:
    """The one the API's routes share (tests make their own)."""
    return Exclusive()

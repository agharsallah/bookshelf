"""Process shutdown signal for long-lived responses (SSE streams).

Uvicorn's graceful shutdown (Ctrl-C, SIGTERM, a `fastapi dev` reload) waits for open
responses before it runs the lifespan shutdown, so a stream that only ends on its own
timer holds the reload for minutes. `install()` (called from the lifespan startup, i.e.
after uvicorn has installed its own handlers) chains SIGINT/SIGTERM so `stopping` is set
the moment shutdown begins; streams check it on every poll and end cleanly. (`fastapi
dev` reloads by sending the server process SIGTERM, so this covers reloads too.)
"""

import signal
import threading
from collections.abc import Callable
from types import FrameType

stopping = threading.Event()

_SIGNALS = (signal.SIGINT, signal.SIGTERM)


def install() -> Callable[[], None]:
    """Start a fresh run and chain the shutdown signals. Returns a function that restores
    the previous handlers. Signal handlers can only be set from the main thread (uvicorn);
    elsewhere (e.g. a test client) only the event is managed."""
    stopping.clear()
    if threading.current_thread() is not threading.main_thread():
        return lambda: None
    previous = {sig: signal.getsignal(sig) for sig in _SIGNALS}

    def chained(signum: int, frame: FrameType | None) -> None:
        stopping.set()
        handler = previous.get(signal.Signals(signum))
        if callable(handler):
            handler(signum, frame)
        elif handler == signal.SIG_DFL:  # nobody else handles it: behave as before
            signal.signal(signum, signal.SIG_DFL)
            signal.raise_signal(signum)

    for sig in _SIGNALS:
        signal.signal(sig, chained)

    def restore() -> None:
        for sig, handler in previous.items():
            signal.signal(sig, handler)

    return restore

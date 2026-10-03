"""Long subprocesses a job waits on (the `claude` CLI, the speech model), tracked so a
stopping API can end them (`terminate_all`) instead of waiting minutes for runs nobody will
record. Each runs in its own process group, so a kill takes its whole tree."""

import contextlib
import os
import signal
import subprocess
import threading
from collections.abc import Iterator

_LIVE: set[subprocess.Popen[str]] = set()
_LIVE_LOCK = threading.Lock()


@contextlib.contextmanager
def tracked(proc: subprocess.Popen[str]) -> Iterator[subprocess.Popen[str]]:
    """`proc` is known to `terminate_all` while the block runs."""
    with _LIVE_LOCK:
        _LIVE.add(proc)
    try:
        yield proc
    finally:
        with _LIVE_LOCK:
            _LIVE.discard(proc)


def communicate_tracked(
    proc: subprocess.Popen[str], stdin: str, *, timeout: float
) -> tuple[str, str]:
    """`proc.communicate`, tracked. On a timeout the whole process group is killed before
    `TimeoutExpired` propagates."""
    with tracked(proc):
        try:
            return proc.communicate(stdin, timeout=timeout)
        except subprocess.TimeoutExpired:
            kill_group(proc)
            proc.communicate()
            raise


def terminate_all() -> int:
    """Kill every tracked process tree this process started (`claude`, the speech model);
    their `run` calls fail. Returns how many were killed."""
    with _LIVE_LOCK:
        procs = list(_LIVE)
    for proc in procs:
        kill_group(proc)
    return len(procs)


def kill_group(proc: subprocess.Popen[str]) -> None:
    with contextlib.suppress(ProcessLookupError):  # already gone
        os.killpg(proc.pid, signal.SIGKILL)

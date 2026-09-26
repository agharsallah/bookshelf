"""Narrations that outlive the API process that started them.

A recording runs for many minutes; `fastapi dev` restarts the API on every save. If the
narration were the API's child, each restart would kill it, and it could never finish.
So it runs detached (own session, output to files, never in `terminate_all`), and one
lock file for the whole audio folder says which narration is running:

    <audio_dir>/narration.lock.json   {pid, key, out, started}
    <out>.result.json                 {key, result}  written by the script when done
    <out>.log                         the script's progress and errors

`run_detached` either attaches to the narration already running for the same request
(the job came back after a reload), collects one that finished while no API was up,
waits for a different one to finish (one model in memory at a time), or starts one.
"""

import contextlib
import hashlib
import json
import logging
import os
import signal
import subprocess
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

LOCK_NAME = "narration.lock.json"
POLL_SECONDS = 2.0
_TAIL = 2000


class DetachedError(RuntimeError):
    """The narration failed, timed out, or ended without a result."""


@dataclass(frozen=True, slots=True)
class Finished:
    result: dict[str, Any]
    seconds: float


def request_key(payload: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:24]


def result_path(out: Path) -> Path:
    return out.with_name(out.name + ".result.json")


def log_path(out: Path) -> Path:
    return out.with_name(out.name + ".log")


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        raw = json.loads(path.read_text("utf-8"))
    except (OSError, ValueError):
        return None
    return raw if isinstance(raw, dict) else None


def _write_json(path: Path, value: dict[str, Any]) -> None:
    partial = path.with_name(path.name + ".tmp")
    partial.write_text(json.dumps(value), "utf-8")
    partial.replace(path)


def _alive(pid: int, marker: str) -> bool:
    """`pid` runs, and is the narration (not a stranger that reused the number)."""
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    try:
        command = subprocess.run(  # noqa: S603  (fixed argv)
            ["/bin/ps", "-p", str(pid), "-o", "command="],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return True  # cannot tell: assume it is ours rather than start a second model
    return marker in command


def _collect(out: Path, key: str, started: float) -> Finished | None:
    done = _read_json(result_path(out))
    if done is None or done.get("key") != key or not out.is_file():
        return None
    return Finished(result=done.get("result") or {}, seconds=time.time() - started)


def _tail(out: Path) -> str:
    try:
        return log_path(out).read_text("utf-8", errors="replace")[-_TAIL:].strip()
    except OSError:
        return ""


def run_detached(
    argv: Sequence[str],
    payload: dict[str, Any],
    *,
    out: Path,
    lock_dir: Path,
    marker: str,
    timeout: float,
    poll: float = POLL_SECONDS,
    sleep: Callable[[float], None] = time.sleep,
) -> Finished:
    """Run (or attach to) the narration for `payload` and wait until it has finished."""
    key = request_key(payload)
    lock_file = lock_dir / LOCK_NAME
    lock_dir.mkdir(parents=True, exist_ok=True)
    out.parent.mkdir(parents=True, exist_ok=True)
    child: subprocess.Popen[bytes] | None = None

    while True:
        lock = _read_json(lock_file)
        live = lock is not None and _alive(int(lock.get("pid", 0)), marker)
        if live and lock is not None and lock.get("key") != key:
            # Another narration holds the model: let it finish before loading a second.
            logger.info("Waiting for another narration", extra={"pid": lock.get("pid")})
            sleep(poll * 5)
            continue
        if live and lock is not None:
            pid, started = int(lock["pid"]), float(lock.get("started", time.time()))
            logger.info("Attached to a running narration", extra={"pid": pid})
            break
        finished = _collect(out, key, time.time())
        if finished is not None:  # it ended while nobody watched
            return finished
        payload_with_result = {**payload, "result": str(result_path(out))}
        with log_path(out).open("ab") as log:
            child = subprocess.Popen(  # noqa: S603  (argv comes from settings)
                list(argv),
                stdin=subprocess.PIPE,
                stdout=log,
                stderr=log,
                start_new_session=True,  # survives the API; its group is killed on timeout
            )
        assert child.stdin is not None  # noqa: S101  (PIPE was requested)
        child.stdin.write(json.dumps(payload_with_result).encode())
        child.stdin.close()
        pid, started = child.pid, time.time()
        _write_json(lock_file, {"pid": pid, "key": key, "out": str(out), "started": started})
        logger.info("Started a narration", extra={"pid": pid})
        break

    try:
        while (child.poll() is None) if child is not None else _alive(pid, marker):
            if time.time() - started > timeout:
                with contextlib.suppress(ProcessLookupError):
                    os.killpg(pid, signal.SIGKILL)
                raise DetachedError(f"narration timed out after {timeout:.0f}s")
            sleep(poll)
        finished = _collect(out, key, started)
        if finished is None:
            code = child.returncode if child is not None else "unknown"
            raise DetachedError(f"narration exited ({code}) without a result: {_tail(out)}")
        return finished
    finally:
        lock = _read_json(lock_file)
        if lock is not None and int(lock.get("pid", 0)) == pid and not _alive(pid, marker):
            lock_file.unlink(missing_ok=True)

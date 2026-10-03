"""The CLI's `--output-format stream-json` output, read as it arrives.

`claude -p --output-format stream-json --verbose --include-partial-messages` prints one
JSON object per line: the session starting, the model's reply as text deltas, whole
assistant messages (with any tool use), tool results, rate-limit notices, and last the
same `result` envelope `--output-format json` prints alone. `pump` reads the lines while
the process runs, hands each to `decode`, which turns the ones worth reading into run-log
events (`app.telemetry.run_log`), and returns the whole stdout so the runner can parse the
envelope (`result_line`) exactly as before.
"""

import contextlib
import json
import subprocess
import threading
from collections.abc import Callable
from typing import Any

from app.telemetry import run_log

_TOOL_CHARS = 2_000


def result_line(stdout: str) -> str:
    """The `result` envelope: the whole of `--output-format json`, the last `result` line
    of `stream-json`. Falls back to `stdout` so a garbled one still fails to parse."""
    for line in reversed(stdout.splitlines()):
        stripped = line.strip()
        if not stripped.startswith("{"):
            continue
        with contextlib.suppress(ValueError):
            if json.loads(stripped).get("type", "result") == "result":
                return stripped
    return stdout


def decode(line: str) -> None:
    """Log what a stream line says, if it is worth reading; anything else is ignored."""
    try:
        event = json.loads(line)
    except ValueError:
        return
    if not isinstance(event, dict):
        return
    kind, subtype = event.get("type"), event.get("subtype")
    if kind == "system" and subtype == "init":
        run_log.event("session", model=event.get("model"), tools=event.get("tools") or [])
    elif kind == "system" and subtype == "status" and event.get("status"):
        run_log.event("status", text=str(event["status"]))
    elif kind == "stream_event":
        _delta(event.get("event") or {})
    elif kind in ("assistant", "user"):
        _message(event.get("message") or {})
    elif kind == "rate_limit_event":
        _limit(event.get("rate_limit_info") or {})


def _delta(event: dict[str, Any]) -> None:
    if event.get("type") != "content_block_delta":
        return
    delta = event.get("delta") or {}
    if delta.get("type") == "text_delta":
        run_log.text("text", str(delta.get("text") or ""))
    elif delta.get("type") == "thinking_delta":
        run_log.text("thinking", str(delta.get("thinking") or ""))


def _message(message: dict[str, Any]) -> None:
    """Whole messages repeat the streamed text; only tool use and its results are new."""
    for block in message.get("content") or []:
        if not isinstance(block, dict):
            continue
        if block.get("type") == "tool_use":
            payload = json.dumps(block.get("input"), ensure_ascii=False)
            run_log.event("tool", name=block.get("name"), input=run_log.clip(payload, _TOOL_CHARS))
        elif block.get("type") == "tool_result":
            content = block.get("content")
            shown = content if isinstance(content, str) else json.dumps(content, ensure_ascii=False)
            run_log.event("tool_result", error=bool(block.get("is_error")),
                          text=run_log.clip(shown, _TOOL_CHARS))  # fmt: skip


def _limit(info: dict[str, Any]) -> None:
    """Only a notice worth acting on: nearing or past a usage limit."""
    status = info.get("status")
    if status in (None, "allowed"):
        return
    run_log.event("limit", status=status, window=info.get("rateLimitType"),
                  utilization=info.get("utilization"), resets_at=info.get("resetsAt"))  # fmt: skip


def pump(
    proc: subprocess.Popen[str], stdin: str, *, timeout: float, kill: Callable[[], None]
) -> tuple[str, str, bool]:
    """Feed `stdin`, decode stdout line by line while the process runs, and collect
    stderr. Past `timeout` seconds `kill` ends it. Returns (stdout, stderr, timed_out)."""
    pipe_in, pipe_out, pipe_err = proc.stdin, proc.stdout, proc.stderr
    if pipe_in is None or pipe_out is None or pipe_err is None:
        raise ValueError("pump needs stdin, stdout and stderr piped")
    timed_out = threading.Event()
    errors: list[str] = []

    def feed() -> None:
        with contextlib.suppress(BrokenPipeError, OSError, ValueError):  # exited early
            pipe_in.write(stdin)
            pipe_in.close()

    def drain() -> None:
        errors.append(pipe_err.read())

    def expire() -> None:
        timed_out.set()
        kill()

    threads = [threading.Thread(target=fn, daemon=True) for fn in (feed, drain)]
    for thread in threads:
        thread.start()
    timer = threading.Timer(timeout, expire)
    timer.start()
    lines: list[str] = []
    try:
        for line in pipe_out:
            lines.append(line)
            decode(line)
        proc.wait()
    finally:
        timer.cancel()
        for thread in threads:
            thread.join(timeout=5)
    return "".join(lines), "".join(errors), timed_out.is_set()

"""Cursor CLI runtime: `agent -p`, the same shape as `claude -p`.

There is no API key. Sign in once with `agent login`; the CLI keeps that session, and a
`CURSOR_API_KEY` in the environment is removed before the process starts so a leftover
key cannot override it.

Each call is one fresh process in an empty temporary directory:

    agent -p --output-format stream-json --stream-partial-output
          --model <id> --mode ask --trust --sandbox enabled
          --workspace <tmpdir>

The prompt is the stdin, never an argument. `--mode ask` answers without writing files
or running shell; the sandbox is a second lock. A vision skill still names its image by
absolute path in the prompt, which ask mode can read. `--trust` is what lets this run
headless: the workspace is the empty temp dir, not this repo.

The stream's `session_id` is the run you can resume (`agent --resume`). It is stored on
`model_runs.external_run_id`. The resolved model name comes from the stream's init event.
"""

import json
import os
import subprocess
import tempfile
import threading
import time
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from app.core.config import Settings, get_settings
from app.models.enums import ModelRuntime, Tier
from app.pipeline.cli_stream import pump, result_line
from app.pipeline.models import cursor_model
from app.pipeline.processes import kill_group, tracked
from app.pipeline.runner import (
    RunnerError,
    RunResult,
    UsageLimitError,
    cli_slots,
    error_envelope,
    usage_limit_message,
)
from app.telemetry import run_log

_STDERR_TAIL = 2000


class CursorCliRunner:
    """Runs one prompt through `agent -p`. Each call is one fresh session."""

    runtime = ModelRuntime.CURSOR

    def __init__(
        self,
        cursor_bin: str | None = None,
        *,
        timeout_seconds: float | None = None,
        slots: threading.BoundedSemaphore | None = None,
        settings: Settings | None = None,
    ) -> None:
        settings = settings or get_settings()
        self._settings = settings
        self.cursor_bin = cursor_bin or settings.cursor_bin
        # One CLI timeout for both runtimes: a call is a call, whichever agent runs it.
        self.timeout_seconds = timeout_seconds or settings.claude_timeout_seconds
        self._slots = slots

    def argv(self, tier: Tier, workspace: str) -> list[str]:
        return [
            self.cursor_bin,
            "-p",
            "--output-format",
            "stream-json",
            "--stream-partial-output",
            "--model",
            cursor_model(tier, self._settings),
            "--mode",
            "ask",
            "--trust",
            "--sandbox",
            "enabled",
            "--workspace",
            workspace,
        ]

    def run(self, prompt: str, *, tier: Tier, images: Sequence[Path] = ()) -> RunResult:
        del images  # absolute paths are already in the prompt; ask mode reads them
        slots = self._slots or cli_slots()
        seen: dict[str, Any] = {}
        with slots, tempfile.TemporaryDirectory(prefix="bookshelf-cursor-") as cwd:
            started = time.monotonic()
            stdout = self._execute(self.argv(tier, cwd), prompt, cwd, seen)
            elapsed = int((time.monotonic() - started) * 1000)
        return parse_cursor_result(stdout, duration_ms=elapsed, seen=seen)

    def _execute(self, argv: list[str], prompt: str, cwd: str, seen: dict[str, Any]) -> str:
        try:
            proc = subprocess.Popen(  # noqa: S603  (argv is built here, never from input)
                argv,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                cwd=cwd,
                env=_login_env(),
                text=True,
                start_new_session=True,
            )
        except OSError as exc:
            raise RunnerError(
                f"cannot start {self.cursor_bin!r}: {exc}. "
                "Install the Cursor CLI and run `agent login`.",
                reached_model=False,
            ) from exc
        with tracked(proc):
            stdout, stderr, timed_out = pump(
                proc,
                prompt,
                timeout=self.timeout_seconds,
                kill=lambda: kill_group(proc),
                on_line=lambda line: observe(line, seen),
            )
        if timed_out:
            raise RunnerError(
                f"cursor timed out after {self.timeout_seconds:g}s",
                reached_model=bool(seen.get("model")),
                external_run_id=_str(seen.get("session_id")),
            )
        if stderr.strip():
            run_log.event("stderr", text=run_log.clip(stderr.strip(), _STDERR_TAIL))
        if proc.returncode != 0:
            raise _failed(proc.returncode, stdout or "", stderr or "", seen)
        return stdout


def _login_env() -> dict[str, str]:
    """The process environment without an API key, so `agent` uses `agent login`."""
    env = os.environ.copy()
    env.pop("CURSOR_API_KEY", None)
    return env


def observe(line: str, seen: dict[str, Any]) -> None:
    """Log a Cursor stream line and remember the session id and model for the result."""
    try:
        event = json.loads(line)
    except ValueError:
        return
    if not isinstance(event, dict):
        return
    kind = event.get("type")
    if kind == "system" and event.get("subtype") == "init":
        seen["model"] = event.get("model")
        seen["session_id"] = event.get("session_id")
        run_log.event(
            "session",
            model=event.get("model"),
            runtime=ModelRuntime.CURSOR.value,
            run_id=event.get("session_id"),
        )
    elif kind == "assistant" and _is_delta(event):
        for block in (event.get("message") or {}).get("content") or []:
            if isinstance(block, dict) and block.get("type") == "text" and block.get("text"):
                run_log.text("text", str(block["text"]))
    elif kind == "tool_call" and event.get("subtype") == "started":
        run_log.event("tool", name=_tool_name(event.get("tool_call")))
    elif kind == "result":
        seen["session_id"] = event.get("session_id") or seen.get("session_id")
        if event.get("request_id"):
            seen["request_id"] = event.get("request_id")


def _is_delta(event: dict[str, Any]) -> bool:
    """A partial-output chunk with new text. Flushes before a tool call repeat it."""
    return "timestamp_ms" in event and "model_call_id" not in event


def _tool_name(call: Any) -> str | None:
    if not isinstance(call, dict):
        return None
    for key, value in call.items():
        if key == "function" and isinstance(value, dict):
            name = value.get("name")
            return str(name) if name else None
        name = str(key)
        if name.endswith("ToolCall"):
            return name.removesuffix("ToolCall")
    return None


def parse_cursor_result(stdout: str, *, duration_ms: int, seen: dict[str, Any]) -> RunResult:
    """Read the terminal `result` event. `seen` holds the model and session from the stream."""
    try:
        envelope = json.loads(result_line(stdout))
    except json.JSONDecodeError as exc:
        raise RunnerError(f"cursor printed no JSON result: {stdout[:200]!r}") from exc
    if not isinstance(envelope, dict):
        raise RunnerError("cursor result is not a JSON object")
    if envelope.get("is_error") or envelope.get("subtype") != "success":
        raise _envelope_error(envelope, seen)
    text = envelope.get("result")
    if not isinstance(text, str) or not text.strip():
        raise RunnerError("cursor result has no text", external_run_id=_session(envelope, seen))
    model = seen.get("model") or envelope.get("model")
    elapsed = envelope.get("duration_ms")
    api_ms = envelope.get("duration_api_ms")
    return RunResult(
        text=text,
        model=str(model) if model else None,
        cost_tokens=_token_sum(envelope),
        duration_ms=elapsed if isinstance(elapsed, int) else duration_ms,
        usage=_usage(envelope),
        api_ms=api_ms if isinstance(api_ms, int) else None,
        external_run_id=_session(envelope, seen),
    )


def _failed(code: int, stdout: str, stderr: str, seen: dict[str, Any]) -> RunnerError:
    """The error a non-zero exit means: its error envelope if it printed one, else stderr."""
    if envelope := error_envelope(stdout):
        return _envelope_error(envelope, seen, prefix=f"cursor exited with {code}")
    detail = (stderr or stdout or "")[-_STDERR_TAIL:].strip()
    session = _str(seen.get("session_id"))
    if usage_limit_message(detail):
        return UsageLimitError(f"usage limit reached: {detail[:500]}", external_run_id=session)
    return RunnerError(
        f"cursor exited with {code}: {detail}",
        reached_model=bool(seen.get("model")),
        external_run_id=session,
    )


def _envelope_error(
    envelope: dict[str, Any], seen: dict[str, Any], *, prefix: str = "cursor reported an error"
) -> RunnerError:
    detail = str(envelope.get("result") or envelope.get("subtype") or "unknown error")
    session = _session(envelope, seen)
    if usage_limit_message(detail):
        return UsageLimitError(f"usage limit reached: {detail[:500]}", external_run_id=session)
    reached = bool(seen.get("model")) or envelope.get("duration_api_ms") not in (0, None)
    return RunnerError(f"{prefix}: {detail[:500]}", reached_model=reached, external_run_id=session)


def _session(envelope: dict[str, Any], seen: dict[str, Any]) -> str | None:
    return _str(envelope.get("session_id") or seen.get("session_id"))


def _str(value: Any) -> str | None:
    return str(value) if isinstance(value, str) and value else None


def _usage(envelope: dict[str, Any]) -> dict[str, Any]:
    """Token counts when the CLI adds them. The documented result has none."""
    raw = envelope.get("usage")
    if not isinstance(raw, dict):
        return {}
    usage: dict[str, Any] = {}
    for source, target in (
        ("input_tokens", "input_tokens"),
        ("output_tokens", "output_tokens"),
        ("cache_read_tokens", "cache_read_input_tokens"),
        ("cache_write_tokens", "cache_creation_input_tokens"),
    ):
        value = raw.get(source)
        if isinstance(value, int) and not isinstance(value, bool):
            usage[target] = value
    return usage


def _token_sum(envelope: dict[str, Any]) -> int | None:
    usage = _usage(envelope)
    counted = [usage[k] for k in ("input_tokens", "output_tokens") if k in usage]
    return sum(counted) if counted else None

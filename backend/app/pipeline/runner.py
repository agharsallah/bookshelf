"""Model runtime (D18): the Claude Code CLI behind a `ModelRunner` seam.

There is no API key in the backend. `ClaudeCliRunner` pipes the rendered prompt to

    claude -p --model <alias> --output-format json --no-session-persistence --safe-mode
           --strict-mcp-config --permission-prompts none --tools ""

from a neutral temporary directory, so no project settings, CLAUDE.md, skills, plugins, MCP
servers or tools leak into a prompt that must be self-contained. Vision skills get exactly
one tool, `Read`, scoped to the directories of the images they must open.

The CLI prints one JSON envelope: the model's reply is in `result`, the resolved model is
the key of `modelUsage`, token counts are in `usage`. `run_structured` turns the reply into
a validated JSON object, retrying once with the errors appended (§14 Schema gate).
"""

import contextlib
import json
import os
import re
import signal
import subprocess
import tempfile
import threading
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

from app.core.config import get_settings
from app.models.enums import Tier
from app.pipeline.models import cli_alias

_FENCE = re.compile(r"^\s*```[a-zA-Z0-9_-]*\s*\n(.*?)\n\s*```\s*$", re.DOTALL)
_STDERR_TAIL = 2000


class RunnerError(RuntimeError):
    """The CLI failed (exit code, timeout, error envelope). Transient: the queue retries."""


class OutputError(ValueError):
    """The reply is not a valid output object, even after the one retry."""

    def __init__(self, problems: list[str]) -> None:
        super().__init__("; ".join(problems))
        self.problems = problems


@dataclass(frozen=True, slots=True)
class RunResult:
    text: str
    model: str | None
    cost_tokens: int | None
    duration_ms: int
    usage: dict[str, Any] = field(default_factory=dict)


class ModelRunner(Protocol):
    def run(self, prompt: str, *, tier: Tier, images: Sequence[Path] = ()) -> RunResult: ...


# --- Envelope and reply parsing --------------------------------------------------


def parse_envelope(stdout: str, *, duration_ms: int = 0) -> RunResult:
    """Read the `--output-format json` envelope. Raises `RunnerError` on error envelopes."""
    try:
        envelope = json.loads(stdout)
    except json.JSONDecodeError as exc:
        raise RunnerError(f"CLI printed no JSON envelope: {stdout[:200]!r}") from exc
    if not isinstance(envelope, dict):
        raise RunnerError("CLI envelope is not a JSON object")
    if envelope.get("is_error") or envelope.get("subtype", "success") != "success":
        detail = next(
            (envelope[k] for k in ("result", "api_error_status", "subtype") if envelope.get(k)),
            "unknown error",
        )
        raise RunnerError(f"CLI reported an error: {str(detail)[:500]}")
    text = envelope.get("result")
    if not isinstance(text, str):
        raise RunnerError("CLI envelope has no `result` text")
    raw_usage = envelope.get("usage")
    usage: dict[str, Any] = raw_usage if isinstance(raw_usage, dict) else {}
    tokens = [usage.get(k) for k in ("input_tokens", "output_tokens")]
    counted = [t for t in tokens if isinstance(t, int)]
    elapsed = envelope.get("duration_ms")
    return RunResult(
        text=text,
        model=_resolved_model(envelope.get("modelUsage")),
        cost_tokens=sum(counted) if counted else None,
        duration_ms=elapsed if isinstance(elapsed, int) else duration_ms,
        usage=usage,
    )


def _resolved_model(model_usage: Any) -> str | None:
    """The model that did the work: the `modelUsage` key with the most output tokens."""
    if not isinstance(model_usage, dict) or not model_usage:
        return None

    def output_tokens(name: str) -> int:
        entry = model_usage[name]
        value = entry.get("outputTokens", 0) if isinstance(entry, dict) else 0
        return value if isinstance(value, int) else 0

    return str(max(model_usage, key=output_tokens))


def _no_constant(name: str) -> Any:
    """`NaN` / `Infinity` parse in Python but are not JSON, and Postgres JSONB refuses them:
    reject them here, where the retry can still fix the reply for free."""
    raise OutputError([f"reply is not valid JSON: {name} is not a number JSON allows"])


def extract_json(text: str) -> dict[str, Any]:
    """Parse a reply into one JSON object: strip ``` fences, else take the outermost `{…}`."""
    fenced = _FENCE.match(text)
    candidate = fenced.group(1) if fenced else text
    start, end = candidate.find("{"), candidate.rfind("}")
    if start == -1 or end < start:
        raise OutputError(["reply contains no JSON object"])
    try:
        value = json.loads(candidate[start : end + 1], parse_constant=_no_constant)
    except json.JSONDecodeError as exc:
        raise OutputError([f"reply is not valid JSON: {exc.msg} at char {exc.pos}"]) from exc
    if not isinstance(value, dict):
        raise OutputError(["reply is not a JSON object"])
    return value


# --- Structured runs with the retry-once rule --------------------------------------

Validate = Callable[[dict[str, Any]], list[str]]


@dataclass(frozen=True, slots=True)
class StructuredRun:
    output: dict[str, Any]
    model: str | None
    cost_tokens: int | None
    duration_ms: int
    retried: bool


def _retry_prompt(prompt: str, problems: list[str]) -> str:
    listed = "\n".join(f"- {p}" for p in problems[:20])
    return (
        f"{prompt}\n\n## Your previous reply was rejected\n\n{listed}\n\n"
        "Reply again with only the corrected JSON object. No prose, no code fences."
    )


def run_structured(
    runner: ModelRunner,
    prompt: str,
    *,
    tier: Tier,
    validate: Validate,
    images: Sequence[Path] = (),
) -> StructuredRun:
    """Run, parse and validate; on failure retry once with the problems appended.

    Raises `OutputError` when the second reply is still unusable.
    """
    runs: list[RunResult] = []
    problems: list[str] = []
    for attempt in range(2):
        result = runner.run(
            prompt if attempt == 0 else _retry_prompt(prompt, problems), tier=tier, images=images
        )
        runs.append(result)
        try:
            output = extract_json(result.text)
        except OutputError as exc:
            problems = exc.problems
            continue
        problems = validate(output)
        if not problems:
            costs = [r.cost_tokens for r in runs if r.cost_tokens is not None]
            return StructuredRun(
                output=output,
                model=result.model,
                cost_tokens=sum(costs) if costs else None,
                duration_ms=sum(r.duration_ms for r in runs),
                retried=attempt == 1,
            )
    raise OutputError(problems)


# --- The CLI runner ------------------------------------------------------------------

_slots_lock = threading.Lock()
_slots: threading.BoundedSemaphore | None = None


def cli_slots() -> threading.BoundedSemaphore:
    """Process-wide cap on concurrent CLI processes (`worker_concurrency`)."""
    global _slots
    with _slots_lock:
        if _slots is None:
            _slots = threading.BoundedSemaphore(get_settings().worker_concurrency)
        return _slots


class ClaudeCliRunner:
    """Runs one prompt through `claude -p`. Each call is one fresh, unsaved session."""

    def __init__(
        self,
        claude_bin: str | None = None,
        *,
        timeout_seconds: float | None = None,
        slots: threading.BoundedSemaphore | None = None,
    ) -> None:
        settings = get_settings()
        self.claude_bin = claude_bin or settings.claude_bin
        self.timeout_seconds = timeout_seconds or settings.claude_timeout_seconds
        self._slots = slots

    def argv(self, tier: Tier, images: Sequence[Path] = ()) -> list[str]:
        argv = [
            self.claude_bin,
            "-p",
            "--model",
            cli_alias(tier),
            "--output-format",
            "json",
            "--no-session-persistence",
            "--safe-mode",
            "--strict-mcp-config",
            "--permission-prompts",
            "none",
        ]
        if not images:
            return [*argv, "--tools", ""]
        dirs = sorted({str(Path(p).resolve().parent) for p in images})
        # `--add-dir` is variadic, so it goes last.
        return [*argv, "--tools", "Read", "--allowedTools", "Read", "--add-dir", *dirs]

    def run(self, prompt: str, *, tier: Tier, images: Sequence[Path] = ()) -> RunResult:
        slots = self._slots or cli_slots()
        with slots, tempfile.TemporaryDirectory(prefix="bookshelf-claude-") as cwd:
            started = time.monotonic()
            stdout = self._execute(self.argv(tier, images), prompt, cwd)
            elapsed = int((time.monotonic() - started) * 1000)
        return parse_envelope(stdout, duration_ms=elapsed)

    def _execute(self, argv: list[str], prompt: str, cwd: str) -> str:
        try:
            proc = subprocess.Popen(  # noqa: S603  (argv is built here, never from input)
                argv,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                cwd=cwd,
                text=True,
                start_new_session=True,  # own process group: a timeout kills the whole tree
            )
        except OSError as exc:
            raise RunnerError(f"cannot start {self.claude_bin!r}: {exc}") from exc
        try:
            stdout, stderr = proc.communicate(prompt, timeout=self.timeout_seconds)
        except subprocess.TimeoutExpired as exc:
            _kill_group(proc)
            proc.communicate()
            raise RunnerError(f"claude timed out after {self.timeout_seconds}s") from exc
        if proc.returncode != 0:
            tail = (stderr or stdout or "")[-_STDERR_TAIL:].strip()
            raise RunnerError(f"claude exited with {proc.returncode}: {tail}")
        return stdout


def _kill_group(proc: subprocess.Popen[str]) -> None:
    with contextlib.suppress(ProcessLookupError):  # already gone
        os.killpg(proc.pid, signal.SIGKILL)


# --- Test double ---------------------------------------------------------------------

Reply = str | Callable[[str], str]


class FakeRunner:
    """Returns canned replies in order (the last one repeats) and records every prompt."""

    def __init__(self, *replies: Reply, model: str = "fake-model-1") -> None:
        if not replies:
            raise ValueError("FakeRunner needs at least one reply")
        self._replies = list(replies)
        self.model = model
        self.calls: list[dict[str, Any]] = []

    def run(self, prompt: str, *, tier: Tier, images: Sequence[Path] = ()) -> RunResult:
        reply = self._replies[min(len(self.calls), len(self._replies) - 1)]
        self.calls.append({"prompt": prompt, "tier": tier, "images": list(images)})
        text = reply(prompt) if callable(reply) else reply
        return RunResult(text=text, model=self.model, cost_tokens=10, duration_ms=1)

"""Model runtime (D18): the Claude Code CLI behind a `ModelRunner` seam.

There is no API key in the backend. `ClaudeCliRunner` pipes the rendered prompt to

    claude -p --model <alias> --output-format stream-json --verbose
           --include-partial-messages --no-session-persistence --safe-mode
           --strict-mcp-config --permission-prompts none --tools ""

from a neutral temporary directory, so no project settings, CLAUDE.md, skills, plugins, MCP
servers or tools leak into a prompt that must be self-contained. Vision skills get exactly
one tool, `Read`, scoped to the directories of the images they must open.

The CLI streams one JSON object per line while it runs (`app.pipeline.cli_stream` logs the
reply as it arrives, for the job's run log) and ends with the JSON envelope: the model's
reply is in `result`, the resolved model is the key of `modelUsage`, token counts are in
`usage`. `run_structured` turns the reply into
a validated JSON object, retrying once with the errors appended (§14 Schema gate).

A usage or rate limit (HTTP 429, "You've hit your session limit · resets 8pm") is a
`UsageLimitError`: every run after it would fail the same way until the limit resets, so
the worker pauses the whole queue rather than burning attempts (`app.jobs.worker`).
"""

import json
import re
import subprocess
import tempfile
import threading
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

from app.core.config import Settings, get_settings
from app.models.enums import Tier
from app.pipeline.cli_stream import pump, result_line
from app.pipeline.models import cli_alias, cli_effort
from app.pipeline.processes import kill_group, tracked
from app.telemetry import run_log

_FENCE = re.compile(r"^\s*```[a-zA-Z0-9_-]*\s*\n(.*?)\n\s*```\s*$", re.DOTALL)
_STDERR_TAIL = 2000


class RunnerError(RuntimeError):
    """The CLI failed (exit code, timeout, error envelope). Transient: the queue retries."""


class UsageLimitError(RunnerError):
    """The account hit a usage or rate limit. Nothing more can run until it resets."""


_LIMIT_TEXT = re.compile(r"\b(usage|session|weekly|rate|daily)[ -]limit\b|hit your .*limit", re.I)


def _limit_error(envelope: dict[str, Any]) -> UsageLimitError | None:
    """A `UsageLimitError` when an error envelope reports a 429 or a limit message."""
    detail = str(envelope.get("result") or "")
    if envelope.get("api_error_status") == 429 or _LIMIT_TEXT.search(detail):
        return UsageLimitError(f"usage limit reached: {(detail or 'HTTP 429')[:500]}")
    return None


def _error_envelope(stdout: str) -> dict[str, Any] | None:
    """The JSON envelope a failed run printed (the CLI exits 1 with one on API errors)."""
    try:
        envelope = json.loads(result_line(stdout))
    except json.JSONDecodeError:
        return None
    return envelope if isinstance(envelope, dict) and envelope.get("is_error") else None


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
    usage: dict[str, Any] = field(default_factory=dict)  # the envelope's raw token counts
    cost_usd: float | None = None  # `total_cost_usd`: what the CLI says the call cost
    api_ms: int | None = None  # `duration_api_ms`: time inside model API calls
    turns: int | None = None  # `num_turns`: model turns (tool use makes more than one)


class ModelRunner(Protocol):
    def run(self, prompt: str, *, tier: Tier, images: Sequence[Path] = ()) -> RunResult: ...


# --- Envelope and reply parsing --------------------------------------------------


def parse_envelope(stdout: str, *, duration_ms: int = 0) -> RunResult:
    """Read the result envelope (alone, or the last line of a stream). Raises `RunnerError`
    on error envelopes."""
    try:
        envelope = json.loads(result_line(stdout))
    except json.JSONDecodeError as exc:
        raise RunnerError(f"CLI printed no JSON envelope: {stdout[:200]!r}") from exc
    if not isinstance(envelope, dict):
        raise RunnerError("CLI envelope is not a JSON object")
    if envelope.get("is_error") or envelope.get("subtype", "success") != "success":
        if limit := _limit_error(envelope):
            raise limit
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
        cost_usd=_float_or_none(envelope.get("total_cost_usd")),
        api_ms=_int_or_none(envelope.get("duration_api_ms")),
        turns=_int_or_none(envelope.get("num_turns")),
    )


def _int_or_none(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _float_or_none(value: Any) -> float | None:
    return float(value) if isinstance(value, int | float) and not isinstance(value, bool) else None


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


_EXCERPT = 60


def _json_problem(exc: json.JSONDecodeError) -> str:
    """A parse error the retry can act on. The retry prompt does not carry the rejected
    reply, so "at char 1384" alone points nowhere: quote the text just before the failure,
    where the usual culprit sits — a `"` copied from the source and left unescaped."""
    before = exc.doc[max(0, exc.pos - _EXCERPT) : exc.pos]
    return (
        f"reply is not valid JSON: {exc.msg} at char {exc.pos}, just after {before!r}; "
        'a double quote inside a string must be written \\"'
    )


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
        raise OutputError([_json_problem(exc)]) from exc
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
    repairs: list[str] = field(default_factory=list)  # shape fixes applied (`repair`)


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
    repair: Callable[[dict[str, Any]], list[str]] | None = None,
) -> StructuredRun:
    """Run, parse, repair and validate; on failure retry once with the problems appended.

    `repair` mends the parsed output in place before validation and returns what it fixed
    (`app.pipeline.repair.repair_blocks` for render-block bodies).

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
            run_log.event("rejected", problems=problems[:20], retrying=attempt == 0)
            continue
        repairs = repair(output) if repair is not None else []
        if repairs:
            run_log.event("repaired", fixes=repairs[:20])
        problems = validate(output)
        if problems:
            run_log.event("rejected", problems=problems[:20], retrying=attempt == 0)
        else:
            run_log.event("accepted", retried=attempt == 1)
            costs = [r.cost_tokens for r in runs if r.cost_tokens is not None]
            return StructuredRun(
                output=output,
                model=result.model,
                cost_tokens=sum(costs) if costs else None,
                duration_ms=sum(r.duration_ms for r in runs),
                retried=attempt == 1,
                repairs=repairs,
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
        settings: Settings | None = None,
    ) -> None:
        settings = settings or get_settings()
        self._settings = settings
        self.claude_bin = claude_bin or settings.claude_bin
        self.timeout_seconds = timeout_seconds or settings.claude_timeout_seconds
        self._slots = slots

    def argv(self, tier: Tier, images: Sequence[Path] = ()) -> list[str]:
        effort = cli_effort(tier, self._settings)
        argv = [
            self.claude_bin,
            "-p",
            "--model",
            cli_alias(tier, self._settings),
            "--effort",
            effort.value,
            "--output-format",
            "stream-json",
            "--verbose",
            "--include-partial-messages",
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
        with tracked(proc):
            stdout, stderr, timed_out = pump(
                proc, prompt, timeout=self.timeout_seconds, kill=lambda: kill_group(proc)
            )
        if timed_out:
            raise RunnerError(f"claude timed out after {self.timeout_seconds}s")
        if stderr.strip():
            run_log.event("stderr", text=run_log.clip(stderr.strip(), _STDERR_TAIL))
        if proc.returncode != 0:
            envelope = _error_envelope(stdout or "")
            if envelope is not None and (limit := _limit_error(envelope)):
                raise limit
            tail = (stderr or stdout or "")[-_STDERR_TAIL:].strip()
            raise RunnerError(f"claude exited with {proc.returncode}: {tail}")
        return stdout


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

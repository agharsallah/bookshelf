"""Reading the agent's `claude -p --output-format stream-json --verbose` output.

The CLI prints one JSON object per line:

    {"type": "system", "subtype": "init", "session_id": …, "model": …, "tools": […]}
    {"type": "assistant", "message": {"content": [
        {"type": "text", "text": …}, {"type": "tool_use", "name": "Bash", "input": {…}}]}}
    {"type": "user", "message": {"content": [{"type": "tool_result", "is_error": …, "content": …}]}}
    {"type": "result", "subtype": "success" | "error_max_budget_usd" | …, "is_error": …,
     "result": "<last message>", "total_cost_usd": …}

Everything here is pure and forgiving: a line that is not JSON (a partial write, a stray
warning) is skipped, never raised. `BuildEvent`s feed the run view; `final_result` reads
the closing `result` line and the `BuildReport` the agent ends with.
"""

import json
import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal

from app.pipeline.runner import _LIMIT_TEXT

EventKind = Literal["text", "tool", "commit", "system", "error"]
TEXT_LIMIT = 300
REPORT_STATUSES = ("goal_reached", "partial", "gave_up")
_LIST_KEYS = ("done", "not_done", "next_steps")
_JSON_FENCE = re.compile(r"```json[ \t]*\n(.*?)\n[ \t]*```", re.DOTALL | re.IGNORECASE)
# Which input field best names what a tool did.
_TOOL_SUBJECT = {
    "Bash": "command", "Read": "file_path", "Write": "file_path", "Edit": "file_path",
    "MultiEdit": "file_path", "NotebookEdit": "notebook_path", "Glob": "pattern",
    "Grep": "pattern", "WebFetch": "url", "WebSearch": "query",
}  # fmt: skip


@dataclass(frozen=True, slots=True)
class BuildEvent:
    at: str
    kind: EventKind
    text: str

    def as_json(self) -> dict[str, str]:
        return {"at": self.at, "kind": self.kind, "text": self.text}


@dataclass(frozen=True, slots=True)
class FinalResult:
    cost_usd: float | None
    is_error: bool
    subtype: str | None
    text: str
    report: dict[str, Any] | None
    usage_limit: bool = False
    session_id: str | None = None

    @property
    def budget_exhausted(self) -> bool:
        """The CLI stopped at `--max-budget-usd` (`error_max_budget_usd`)."""
        return "budget" in (self.subtype or "").lower()


def now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def truncate(text: str, limit: int = TEXT_LIMIT) -> str:
    flat = " ".join(text.split())
    return flat if len(flat) <= limit else f"{flat[: limit - 1]}…"


def parse_json_line(line: str) -> dict[str, Any] | None:
    line = line.strip()
    if not line.startswith("{"):
        return None
    try:
        value = json.loads(line)
    except ValueError:
        return None
    return value if isinstance(value, dict) else None


def tool_summary(name: str, tool_input: Any) -> str:
    """`Bash: pnpm test`, `Edit: src/model.py`, or the bare tool name."""
    if not isinstance(tool_input, Mapping):
        return name
    key = _TOOL_SUBJECT.get(name)
    subject = tool_input.get(key) if key else None
    if subject is None:
        subject = next((v for v in tool_input.values() if isinstance(v, str) and v), None)
    if name == "TodoWrite" and isinstance(tool_input.get("todos"), list):
        subject = f"{len(tool_input['todos'])} items"
    return f"{name}: {subject}" if subject else name


def _blocks(message: Any) -> list[Mapping[str, Any]]:
    content = message.get("content") if isinstance(message, Mapping) else None
    if isinstance(content, str):
        return [{"type": "text", "text": content}]
    return [b for b in content if isinstance(b, Mapping)] if isinstance(content, list) else []


def _result_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(str(b.get("text", "")) for b in content if isinstance(b, Mapping))
    return ""


def events_from(obj: Mapping[str, Any], *, at: str) -> list[BuildEvent]:
    """The run-view events one stream-json object stands for (often none)."""
    kind = obj.get("type")
    out: list[BuildEvent] = []
    if kind == "system" and obj.get("subtype") == "init":
        model = obj.get("model") or "?"
        out.append(BuildEvent(at, "system", f"session started ({model})"))
    elif kind == "assistant":
        for block in _blocks(obj.get("message")):
            if block.get("type") == "text" and str(block.get("text", "")).strip():
                out.append(BuildEvent(at, "text", truncate(str(block["text"]))))
            elif block.get("type") == "tool_use":
                summary = tool_summary(str(block.get("name", "tool")), block.get("input"))
                out.append(BuildEvent(at, "tool", truncate(summary)))
    elif kind == "user":
        for block in _blocks(obj.get("message")):
            if block.get("type") == "tool_result" and block.get("is_error"):
                text = _result_text(block.get("content")) or "tool error"
                out.append(BuildEvent(at, "error", truncate(text)))
    elif kind == "result":
        if obj.get("is_error") or obj.get("subtype", "success") != "success":
            detail = obj.get("result") or obj.get("subtype") or "error"
            out.append(BuildEvent(at, "error", truncate(f"run ended: {detail}")))
        else:
            cost = obj.get("total_cost_usd")
            tail = f" (${cost:.2f})" if isinstance(cost, int | float) else ""
            out.append(BuildEvent(at, "system", f"run finished{tail}"))
    return out


def parse_lines(lines: Iterable[str], *, at: str | None = None) -> list[BuildEvent]:
    stamp = at or now_iso()
    events: list[BuildEvent] = []
    for line in lines:
        if (obj := parse_json_line(line)) is not None:
            events.extend(events_from(obj, at=stamp))
    return events


def extract_report(text: str) -> dict[str, Any] | None:
    """The last fenced ```json block of `text` as a BuildReport, loosely checked: a known
    `status` is required; list fields are coerced to lists of strings."""
    for raw in reversed(_JSON_FENCE.findall(text or "")):
        try:
            value = json.loads(raw)
        except ValueError:
            continue
        if not isinstance(value, dict) or value.get("status") not in REPORT_STATUSES:
            continue
        report: dict[str, Any] = {"status": value["status"]}
        for key in _LIST_KEYS:
            items = value.get(key)
            report[key] = [str(i) for i in items] if isinstance(items, list) else []
        report["run_it"] = str(value.get("run_it") or "")
        return report
    return None


def is_usage_limit(obj: Mapping[str, Any]) -> bool:
    """An error `result` that is the account's usage or rate limit (as `app.pipeline.runner`)."""
    if not (obj.get("is_error") or obj.get("subtype", "success") != "success"):
        return False
    detail = str(obj.get("result") or "")
    return obj.get("api_error_status") == 429 or bool(_LIMIT_TEXT.search(detail))


def final_result(lines: Iterable[str]) -> FinalResult | None:
    """The last `result` line, or None when the run ended without one (killed, crashed)."""
    last: dict[str, Any] | None = None
    for line in lines:
        obj = parse_json_line(line)
        if obj is not None and obj.get("type") == "result":
            last = obj
    if last is None:
        return None
    cost = last.get("total_cost_usd")
    text = str(last.get("result") or "")
    return FinalResult(
        cost_usd=float(cost)
        if isinstance(cost, int | float) and not isinstance(cost, bool)
        else None,
        is_error=bool(last.get("is_error")),
        subtype=str(last["subtype"]) if last.get("subtype") else None,
        text=text,
        report=extract_report(text),
        usage_limit=is_usage_limit(last),
        session_id=str(last["session_id"]) if last.get("session_id") else None,
    )

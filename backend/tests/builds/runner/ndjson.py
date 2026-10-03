"""Realistic `claude -p --output-format stream-json --verbose` lines for the build tests."""

import json
from typing import Any

SESSION = "2b1f6c1e-6a3b-4e55-9f0e-0c7e6f1b9a11"


def line(obj: dict[str, Any]) -> str:
    return json.dumps(obj) + "\n"


def init() -> str:
    return line({"type": "system", "subtype": "init", "session_id": SESSION,
                 "model": "claude-opus-5-5", "tools": ["Read", "Bash"],
                 "permissionMode": "dontAsk", "cwd": "/w/repo"})  # fmt: skip


def say(text: str) -> str:
    return line({"type": "assistant", "session_id": SESSION, "message": {
        "id": "msg_1", "role": "assistant", "model": "claude-opus-5-5",
        "content": [{"type": "text", "text": text}]}})  # fmt: skip


def tool(name: str, **tool_input: Any) -> str:
    use = {"type": "tool_use", "id": "toolu_1", "name": name, "input": tool_input}
    message = {"role": "assistant", "content": [use]}
    return line({"type": "assistant", "session_id": SESSION, "message": message})


def tool_result(content: str, *, is_error: bool = False) -> str:
    return line({"type": "user", "session_id": SESSION, "message": {"role": "user", "content": [
        {"type": "tool_result", "tool_use_id": "toolu_1", "content": content,
         "is_error": is_error}]}})  # fmt: skip


REPORT = {"status": "goal_reached", "done": ["attention"], "not_done": [],
          "next_steps": ["train longer"], "run_it": "uv run python train.py"}  # fmt: skip


def result(
    *, report: dict[str, Any] | None = REPORT, subtype: str = "success",
    is_error: bool = False, cost: float = 1.25, text: str | None = None, **extra: Any,
) -> str:  # fmt: skip
    if text is None:
        text = (
            "All milestones are in.\n\n```json\n" + json.dumps(report) + "\n```" if report else ""
        )
    return line({"type": "result", "subtype": subtype, "is_error": is_error, "result": text,
                 "total_cost_usd": cost, "duration_ms": 1000, "num_turns": 12,
                 "session_id": SESSION, **extra})  # fmt: skip

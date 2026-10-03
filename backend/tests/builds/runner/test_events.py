import json

from app.builds.events import (
    extract_report,
    final_result,
    parse_lines,
    tool_summary,
    truncate,
)
from tests.builds.runner import ndjson


def _kinds_texts(lines: list[str]) -> list[tuple[str, str]]:
    return [(e.kind, e.text) for e in parse_lines(lines, at="2026-10-03T10:00:00+00:00")]


def test_a_stream_becomes_run_view_events() -> None:
    lines = [
        ndjson.init(),
        ndjson.say("I'll start with attention."),
        ndjson.tool("Bash", command="uv run pytest -q", description="run tests"),
        ndjson.tool_result("3 passed"),
        ndjson.tool("Edit", file_path="src/model.py", old_string="a", new_string="b"),
        ndjson.tool_result("Claude requested permissions to use Bash(git push)", is_error=True),
        ndjson.tool("TodoWrite", todos=[{"content": "a"}, {"content": "b"}]),
        ndjson.result(),
    ]
    assert _kinds_texts(lines) == [
        ("system", "session started (claude-opus-5-5)"),
        ("text", "I'll start with attention."),
        ("tool", "Bash: uv run pytest -q"),
        ("tool", "Edit: src/model.py"),
        ("error", "Claude requested permissions to use Bash(git push)"),
        ("tool", "TodoWrite: 2 items"),
        ("system", "run finished ($1.25)"),
    ]


def test_garbage_lines_are_skipped() -> None:
    lines = ["", "not json", "[1, 2]", '{"type": "assistant", "message": "odd"}', '{"type":',
             ndjson.say("still here")]  # fmt: skip
    assert _kinds_texts(lines) == [("text", "still here")]


def test_long_text_is_truncated() -> None:
    (event,) = parse_lines([ndjson.say("word " * 200)])
    assert len(event.text) == 300 and event.text.endswith("…")
    assert truncate("a\n  b") == "a b"


def test_tool_summary_fallbacks() -> None:
    assert tool_summary("Glob", {"pattern": "**/*.py"}) == "Glob: **/*.py"
    assert tool_summary("Mystery", {"x": "y"}) == "Mystery: y"
    assert tool_summary("Mystery", None) == "Mystery"


def test_final_result_reads_cost_and_report() -> None:
    final = final_result([ndjson.init(), ndjson.say("hi"), ndjson.result(), "garbage"])
    assert final is not None
    assert final.cost_usd == 1.25 and not final.is_error and final.subtype == "success"
    assert final.report == ndjson.REPORT
    assert final.session_id == ndjson.SESSION
    assert not final.budget_exhausted and not final.usage_limit


def test_no_result_line_means_none() -> None:
    assert final_result([ndjson.init(), ndjson.say("working")]) is None


def test_budget_subtype() -> None:
    final = final_result([ndjson.result(report=None, subtype="error_max_budget_usd",
                                        is_error=True, cost=5.01)])  # fmt: skip
    assert final is not None and final.budget_exhausted and final.is_error
    assert final.report is None


def test_usage_limit_is_detected() -> None:
    limit = final_result([ndjson.result(text="You've hit your session limit · resets 8pm",
                                        is_error=True, report=None)])  # fmt: skip
    status = final_result([ndjson.result(text="API Error", is_error=True, report=None,
                                         api_error_status=429)])  # fmt: skip
    other = final_result([ndjson.result(text="Tool crashed", is_error=True, report=None)])
    assert limit is not None and limit.usage_limit
    assert status is not None and status.usage_limit
    assert other is not None and not other.usage_limit


def test_extract_report_takes_the_last_valid_block() -> None:
    first = {"status": "partial", "done": [], "not_done": ["x"], "next_steps": [], "run_it": ""}
    last = {"status": "gave_up", "done": "not a list", "run_it": None}
    text = (
        f"Draft:\n```json\n{json.dumps(first)}\n```\nFinal:\n```json\n{json.dumps(last)}\n```\n"
        "```json\n{not json}\n```"
    )
    assert extract_report(text) == {
        "status": "gave_up", "done": [], "not_done": [], "next_steps": [], "run_it": "",
    }  # fmt: skip
    assert extract_report('```json\n{"status": "unknown"}\n```') is None
    assert extract_report("no block") is None

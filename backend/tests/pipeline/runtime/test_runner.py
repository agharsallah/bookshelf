"""The CLI runner: envelope parsing, reply extraction, retry-once, and the subprocess
contract, exercised against a fake `claude` executable (never the real CLI)."""

import json
import os
import stat
import subprocess
import threading
import time
import uuid
from pathlib import Path

import pytest

from app.core.config import Settings
from app.models.enums import Tier
from app.pipeline.runner import (
    ClaudeCliRunner,
    FakeRunner,
    OutputError,
    RunnerError,
    UsageLimitError,
    extract_json,
    parse_envelope,
    run_structured,
)
from app.telemetry import run_log

ENVELOPE = {
    "type": "result",
    "subtype": "success",
    "is_error": False,
    "duration_ms": 1499,
    "result": '```json\n{"ok": true}\n```',
    "usage": {"input_tokens": 3508, "output_tokens": 57},
    "modelUsage": {
        "claude-haiku-4-5-20251001": {"inputTokens": 3508, "outputTokens": 57},
        "claude-side-model": {"inputTokens": 10, "outputTokens": 1},
    },
}


def test_envelope_yields_text_resolved_model_and_tokens():
    result = parse_envelope(json.dumps(ENVELOPE))

    assert result.text == '```json\n{"ok": true}\n```'
    assert result.model == "claude-haiku-4-5-20251001"
    assert result.cost_tokens == 3565
    assert result.duration_ms == 1499
    assert (result.cost_usd, result.api_ms, result.turns) == (None, None, None)


def test_envelope_keeps_cost_api_time_and_turns_for_telemetry():
    envelope = {**ENVELOPE, "total_cost_usd": 0.0123, "duration_api_ms": 1210, "num_turns": 2}

    result = parse_envelope(json.dumps(envelope))

    assert result.cost_usd == pytest.approx(0.0123)
    assert result.api_ms == 1210
    assert result.turns == 2


@pytest.mark.parametrize(
    "envelope",
    [
        {**ENVELOPE, "is_error": True, "result": "Credit balance too low"},
        {**ENVELOPE, "subtype": "error_max_turns"},
        {"type": "result", "subtype": "success"},
    ],
)
def test_error_envelopes_raise_runner_errors(envelope):
    with pytest.raises(RunnerError):
        parse_envelope(json.dumps(envelope))


# What `claude -p` prints (and exits 1 with) when the account's limit is reached.
LIMIT_ENVELOPE = {
    **ENVELOPE,
    "is_error": True,
    "api_error_status": 429,
    "result": "You've hit your session limit · resets 8pm (Europe/Berlin)",
}


@pytest.mark.parametrize(
    "envelope",
    [
        LIMIT_ENVELOPE,
        {**LIMIT_ENVELOPE, "api_error_status": None},  # the message alone
        {**LIMIT_ENVELOPE, "result": "Overloaded"},  # the 429 alone
    ],
)
def test_a_usage_limit_is_its_own_runner_error(envelope):
    with pytest.raises(UsageLimitError, match="usage limit reached"):
        parse_envelope(json.dumps(envelope))


def test_other_error_envelopes_are_not_usage_limits():
    envelope = {**ENVELOPE, "is_error": True, "result": "Credit balance too low"}
    with pytest.raises(RunnerError) as caught:
        parse_envelope(json.dumps(envelope))
    assert not isinstance(caught.value, UsageLimitError)


def test_an_error_envelope_says_its_own_words_and_whether_the_model_was_reached():
    refused = {"type": "result", "is_error": True, "duration_api_ms": 0, "total_cost_usd": 0,
               "result": "Credit balance is too low"}  # fmt: skip
    called = {**refused, "duration_api_ms": 1200, "result": "Overloaded"}

    with pytest.raises(RunnerError, match="Credit balance is too low") as never:
        parse_envelope(json.dumps(refused))
    with pytest.raises(RunnerError) as reached:
        parse_envelope(json.dumps(called))

    assert never.value.reached_model is False
    assert reached.value.reached_model is True


def test_non_json_stdout_is_a_runner_error():
    with pytest.raises(RunnerError, match="no JSON envelope"):
        parse_envelope("Error: not logged in")


@pytest.mark.parametrize(
    "text",
    [
        '{"ok": true}',
        '```json\n{"ok": true}\n```',
        'Here you go:\n{"ok": true}\nHope that helps.',
    ],
)
def test_reply_json_is_extracted_from_fences_and_prose(text):
    assert extract_json(text) == {"ok": True}


@pytest.mark.parametrize(
    "text",
    [
        "no json here",
        "[1, 2]",
        '{"broken": ',
        # Python's json accepts these; Postgres JSONB does not, so the insert would fail
        # after the model was paid, and the queue would pay again on every retry.
        '{"points": [{"x": 1, "y": NaN}]}',
        '{"value": Infinity}',
        '{"value": -Infinity}',
    ],
)
def test_unusable_replies_raise_output_errors(text):
    with pytest.raises(OutputError):
        extract_json(text)


def test_a_parse_error_quotes_the_text_before_it_so_the_retry_can_find_it():
    """The retry prompt does not carry the rejected reply; "at char 1384" pointed nowhere."""
    reply = '{"text": "It runs search_dir "notes" next.", "cites": []}'

    with pytest.raises(OutputError) as caught:
        extract_json(reply)

    [problem] = caught.value.problems
    assert problem.startswith("reply is not valid JSON: Expecting ',' delimiter at char 30")
    assert '\'{"text": "It runs search_dir "\'' in problem
    assert problem.endswith('a double quote inside a string must be written \\"')


def test_run_structured_retries_once_with_the_problems_appended():
    runner = FakeRunner("not json", '{"blocks": []}')

    run = run_structured(runner, "PROMPT", tier=Tier.DISTIL, validate=lambda _: [])

    assert run.output == {"blocks": []}
    assert run.retried is True
    assert run.cost_tokens == 20
    assert runner.calls[1]["prompt"].startswith("PROMPT\n\n## Your previous reply was rejected")
    assert "- reply contains no JSON object" in runner.calls[1]["prompt"]


def test_run_structured_fails_after_the_second_invalid_reply():
    runner = FakeRunner('{"blocks": 1}')

    with pytest.raises(OutputError) as caught:
        run_structured(runner, "P", tier=Tier.DISTIL, validate=lambda out: ["blocks: not a list"])

    assert caught.value.problems == ["blocks: not a list"]
    assert len(runner.calls) == 2


def test_first_valid_reply_is_not_retried():
    runner = FakeRunner('{"blocks": []}')

    run = run_structured(runner, "P", tier=Tier.EXPLORE, validate=lambda _: [])

    assert run.retried is False
    assert len(runner.calls) == 1


# --- ClaudeCliRunner against a fake executable --------------------------------------


@pytest.fixture(scope="module")
def claude_bin(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """A tiny POSIX-shell `claude` stand-in, created once per module and run once to warm
    it up (macOS scans every new executable on first exec, which costs ~0.2 s). Each call
    records argv, cwd, stdin and pid into `$FAKE_CLAUDE_DIR`, then sources its `action.sh`."""
    script = tmp_path_factory.mktemp("bin") / "claude"
    script.write_text(
        "#!/bin/sh\n"
        'out="$FAKE_CLAUDE_DIR"\n'
        'printf \'%s\\n\' "$@" > "$out/argv"; pwd > "$out/cwd"; echo $$ > "$out/pid"\n'
        'cat > "$out/stdin"\n'
        '. "$out/action.sh"\n'
    )
    script.chmod(script.stat().st_mode | stat.S_IEXEC)
    warm = tmp_path_factory.mktemp("warm")
    (warm / "action.sh").write_text("true\n")
    env = {**os.environ, "FAKE_CLAUDE_DIR": str(warm)}
    subprocess.run([script], input=b"", env=env, check=True)  # noqa: S603  (our own fake)
    return script


@pytest.fixture
def fake_claude(claude_bin: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    def configure(action: str) -> Path:
        (tmp_path / "envelope.json").write_text(json.dumps(ENVELOPE))
        (tmp_path / "action.sh").write_text(action + "\n")
        monkeypatch.setenv("FAKE_CLAUDE_DIR", str(tmp_path))
        return claude_bin

    return configure


PRINT_ENVELOPE = 'cat "$out/envelope.json"'


def recorded(tmp_path: Path) -> dict:
    argv = (tmp_path / "argv").read_text().split("\n")[:-1]
    return {
        "argv": argv,
        "cwd": (tmp_path / "cwd").read_text().strip(),
        "stdin": (tmp_path / "stdin").read_text(),
        "pid": int((tmp_path / "pid").read_text()),
    }


def cli(script: Path, timeout: float = 5) -> ClaudeCliRunner:
    return ClaudeCliRunner(
        str(script), timeout_seconds=timeout, slots=threading.BoundedSemaphore(1)
    )


def test_cli_pipes_the_prompt_on_stdin_with_no_tools_from_a_neutral_cwd(fake_claude, tmp_path):
    script = fake_claude(PRINT_ENVELOPE)

    result = cli(script).run("Distil this.", tier=Tier.DISTIL)

    call = recorded(tmp_path)
    assert result.model == "claude-haiku-4-5-20251001"
    assert call["stdin"] == "Distil this."
    assert call["argv"] == [
        "-p", "--model", "sonnet", "--effort", "medium", "--output-format", "stream-json",
        "--verbose", "--include-partial-messages", "--no-session-persistence",
        "--safe-mode", "--strict-mcp-config", "--permission-prompts", "none", "--tools", "",
    ]  # fmt: skip
    assert "bookshelf-claude-" in call["cwd"]
    assert not Path(call["cwd"]).exists()  # the temp dir is cleaned up


def test_a_tier_effort_is_passed_to_the_cli_right_after_its_model(fake_claude, tmp_path):
    script = fake_claude(PRINT_ENVELOPE)
    settings = Settings(_env_file=None, effort_distil="high")  # type: ignore[call-arg]
    runner = ClaudeCliRunner(
        str(script), timeout_seconds=5, slots=threading.BoundedSemaphore(1), settings=settings
    )

    runner.run("Distil this.", tier=Tier.DISTIL)

    argv = recorded(tmp_path)["argv"]
    assert argv[:5] == ["-p", "--model", "sonnet", "--effort", "high"]


def test_vision_runs_get_only_the_read_tool_scoped_to_the_image_dir(fake_claude, tmp_path):
    script = fake_claude(PRINT_ENVELOPE)
    image = tmp_path / "media" / "f001.png"

    cli(script).run("Describe.", tier=Tier.EXPLORE, images=[image])

    argv = recorded(tmp_path)["argv"]
    assert argv[argv.index("--model") + 1] == "haiku"
    assert argv[-6:] == [
        "--tools", "Read", "--allowedTools", "Read", "--add-dir", str(image.parent.resolve()),
    ]  # fmt: skip


def test_non_zero_exit_raises_with_stderr(fake_claude):
    script = fake_claude("echo 'rate limited' >&2; exit 3")

    with pytest.raises(RunnerError, match="exited with 3: rate limited"):
        cli(script).run("P", tier=Tier.DISTIL)


def test_a_limit_envelope_on_a_failed_exit_is_a_usage_limit(fake_claude):
    script = fake_claude(f"cat <<'EOF'\n{json.dumps(LIMIT_ENVELOPE)}\nEOF\nexit 1")

    with pytest.raises(UsageLimitError, match="resets 8pm"):
        cli(script).run("P", tier=Tier.DISTIL)


def test_a_failed_exit_quotes_the_envelope_not_its_raw_json(fake_claude):
    refused = {"type": "result", "is_error": True, "duration_api_ms": 0, "result": "Not logged in"}
    script = fake_claude(f"cat <<'EOF'\n{json.dumps(refused)}\nEOF\nexit 1")

    with pytest.raises(RunnerError) as error:
        cli(script).run("P", tier=Tier.DISTIL)

    assert str(error.value) == "claude exited with 1: Not logged in"
    assert error.value.reached_model is False


def test_timeout_kills_the_process_and_raises(fake_claude, tmp_path):
    script = fake_claude("exec sleep 30")
    started = time.monotonic()

    with pytest.raises(RunnerError, match="timed out"):
        cli(script, timeout=0.2).run("P", tier=Tier.DISTIL)

    assert time.monotonic() - started < 10  # killed, not waited out (the sleep is 30 s)
    with pytest.raises(ProcessLookupError):
        os.kill(recorded(tmp_path)["pid"], 0)


STREAM = [
    {"type": "system", "subtype": "init", "model": "claude-haiku-4-5-20251001", "tools": []},
    {"type": "stream_event", "event": {"type": "content_block_delta", "index": 0,
                                       "delta": {"type": "text_delta", "text": '{"ok": '}}},
    {"type": "stream_event", "event": {"type": "content_block_delta", "index": 0,
                                       "delta": {"type": "text_delta", "text": "true}"}}},
    {"type": "assistant", "message": {"content": [{"type": "text", "text": '{"ok": true}'}]}},
    {"type": "rate_limit_event", "rate_limit_info": {"status": "allowed_warning",
                                                     "rateLimitType": "seven_day",
                                                     "utilization": 0.9}},
    ENVELOPE,
]  # fmt: skip


def test_a_streamed_run_parses_its_last_envelope_and_logs_the_reply_as_it_arrives(
    fake_claude, tmp_path
):
    lines = "\n".join(json.dumps(e) for e in STREAM)
    script = fake_claude(f"cat <<'EOF'\n{lines}\nEOF")
    job_id = uuid.uuid4()

    with run_log.job_log(job_id, attempt=1, directory=tmp_path / "logs"):
        result = cli(script).run("P", tier=Tier.DISTIL)

    assert result.model == "claude-haiku-4-5-20251001"
    events, _ = run_log.read(job_id, directory=tmp_path / "logs")
    assert [e["type"] for e in events] == ["session", "text", "limit"]
    assert events[1]["text"] == '{"ok": true}'  # the deltas, joined
    assert (events[2]["status"], events[2]["utilization"]) == ("allowed_warning", 0.9)


def test_missing_binary_is_a_runner_error(tmp_path: Path):
    with pytest.raises(RunnerError, match="cannot start"):
        cli(tmp_path / "nope").run("P", tier=Tier.DISTIL)

"""Cursor CLI: `agent -p` from a logged-in session, prompt on stdin, no API key."""

import json
import os
import stat
import subprocess
import threading
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.core.config import Settings
from app.models.enums import ModelRuntime, Tier
from app.pipeline.cursor_runner import CursorCliRunner
from app.pipeline.factory import make_runner
from app.pipeline.runner import ClaudeCliRunner, RunnerError, UsageLimitError

RESULT = {
    "type": "result",
    "subtype": "success",
    "is_error": False,
    "duration_ms": 40,
    "duration_api_ms": 30,
    "result": '{"ok": true}',
    "session_id": "sess-1",
    "request_id": "req-1",
}
INIT = {
    "type": "system",
    "subtype": "init",
    "apiKeySource": "login",
    "model": "Composer 2.5",
    "session_id": "sess-1",
}


@pytest.fixture(scope="module")
def agent_bin(tmp_path_factory: pytest.TempPathFactory) -> Path:
    script = tmp_path_factory.mktemp("bin") / "agent"
    script.write_text(
        "#!/bin/sh\n"
        'out="$FAKE_AGENT_DIR"\n'
        'printf \'%s\\n\' "$@" > "$out/argv"; pwd > "$out/cwd"; echo $$ > "$out/pid"\n'
        'cat > "$out/stdin"\n'
        'if [ -n "$CURSOR_API_KEY" ]; then echo "$CURSOR_API_KEY" > "$out/key"; fi\n'
        '. "$out/action.sh"\n'
    )
    script.chmod(script.stat().st_mode | stat.S_IEXEC)
    warm = tmp_path_factory.mktemp("warm")
    (warm / "action.sh").write_text("true\n")
    env = {**os.environ, "FAKE_AGENT_DIR": str(warm)}
    env.pop("CURSOR_API_KEY", None)
    subprocess.run([script], input=b"", env=env, check=True)  # noqa: S603  (our own fake)
    return script


@pytest.fixture
def fake_agent(agent_bin: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    def configure(action: str) -> Path:
        (tmp_path / "action.sh").write_text(action + "\n")
        monkeypatch.setenv("FAKE_AGENT_DIR", str(tmp_path))
        return agent_bin

    return configure


def _stream(*events: dict) -> str:
    body = "\n".join(json.dumps(event) for event in events)
    return f"cat <<'EOF'\n{body}\nEOF"


def recorded(tmp_path: Path) -> dict:
    argv = (tmp_path / "argv").read_text().split("\n")[:-1]
    return {
        "argv": argv,
        "cwd": (tmp_path / "cwd").read_text().strip(),
        "stdin": (tmp_path / "stdin").read_text(),
    }


def cli(script: Path, **settings: object) -> CursorCliRunner:
    return CursorCliRunner(
        str(script),
        timeout_seconds=5,
        slots=threading.BoundedSemaphore(1),
        settings=Settings(_env_file=None, **settings),  # type: ignore[arg-type]
    )


def test_a_call_pipes_the_prompt_and_keeps_the_session_id(fake_agent, tmp_path: Path):
    script = fake_agent(_stream(INIT, RESULT))

    result = cli(script).run("Distil this.", tier=Tier.DISTIL)

    call = recorded(tmp_path)
    assert call["stdin"] == "Distil this."
    assert call["argv"][:8] == [
        "-p", "--output-format", "stream-json", "--stream-partial-output",
        "--model", "composer-2.5", "--mode", "ask",
    ]  # fmt: skip
    assert "--force" not in call["argv"]
    assert "--api-key" not in call["argv"]
    assert call["argv"][-2] == "--workspace"
    assert Path(call["argv"][-1]).resolve() == Path(call["cwd"]).resolve()
    assert "bookshelf-cursor-" in call["cwd"]
    assert not Path(call["cwd"]).exists()
    assert (result.text, result.model, result.external_run_id) == (
        '{"ok": true}', "Composer 2.5", "sess-1",
    )  # fmt: skip
    assert result.api_ms == 30


def test_a_model_override_is_the_model_flag(fake_agent, tmp_path: Path):
    script = fake_agent(_stream(INIT, RESULT))

    cli(script, cursor_model_reason="composer-2.5-fast").run("P", tier=Tier.REASON)

    argv = recorded(tmp_path)["argv"]
    assert argv[argv.index("--model") + 1] == "composer-2.5-fast"


def test_an_api_key_in_the_environment_is_not_given_to_the_cli(
    fake_agent, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setenv("CURSOR_API_KEY", "cursor_secret")
    script = fake_agent(_stream(INIT, RESULT))

    cli(script).run("P", tier=Tier.EXPLORE)

    assert not (tmp_path / "key").exists()


def test_a_usage_limit_on_stderr_pauses_the_queue(fake_agent):
    script = fake_agent("echo 'You have hit your usage limit' >&2; exit 1")

    with pytest.raises(UsageLimitError, match="usage limit"):
        cli(script).run("P", tier=Tier.DISTIL)


def test_not_logged_in_did_not_reach_the_model(fake_agent):
    script = fake_agent("echo 'Not logged in' >&2; exit 1")

    with pytest.raises(RunnerError, match="Not logged in") as error:
        cli(script).run("P", tier=Tier.DISTIL)

    assert error.value.reached_model is False


def test_an_error_envelope_on_a_failed_exit_keeps_its_words_and_session(fake_agent):
    failed = {**RESULT, "subtype": "error", "is_error": True, "result": "model overloaded"}
    script = fake_agent(_stream(INIT, failed) + "\nexit 1")

    with pytest.raises(RunnerError, match="cursor exited with 1: model overloaded") as error:
        cli(script).run("P", tier=Tier.DISTIL)

    assert (error.value.reached_model, error.value.external_run_id) == (True, "sess-1")


def test_a_missing_binary_says_to_log_in():
    runner = CursorCliRunner(
        "/nonexistent/agent", timeout_seconds=5, slots=threading.BoundedSemaphore(1),
        settings=Settings(_env_file=None),  # type: ignore[call-arg]
    )  # fmt: skip

    with pytest.raises(RunnerError, match="agent login") as error:
        runner.run("P", tier=Tier.DISTIL)

    assert error.value.reached_model is False


def test_make_runner_follows_the_runtime_setting():
    assert isinstance(make_runner(settings=Settings(_env_file=None)), ClaudeCliRunner)  # type: ignore[call-arg]
    cursor = make_runner(settings=Settings(_env_file=None, model_runtime="cursor"))  # type: ignore[call-arg]
    assert isinstance(cursor, CursorCliRunner)
    assert cursor.runtime is ModelRuntime.CURSOR


def test_a_blank_runtime_stays_on_claude(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("BOOKSHELF_MODEL_RUNTIME", " ")

    assert Settings(_env_file=None).model_runtime == "claude"  # type: ignore[call-arg]


def test_an_unknown_runtime_fails_at_startup():
    with pytest.raises(ValidationError, match="model_runtime"):
        Settings(_env_file=None, model_runtime="openai")  # type: ignore[call-arg]

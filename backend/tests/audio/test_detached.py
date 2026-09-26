"""Detached narrations (`app.audio.detached`): a stand-in script plays the speech model.

It reads the request on stdin, waits `hold` seconds (or until a `go` file appears), then
writes the audio and its result the way scripts/narrate/vibevoice.py does.
"""

import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

import pytest

from app.audio.detached import LOCK_NAME, DetachedError, request_key, result_path, run_detached

FAKE = """
import hashlib, json, pathlib, sys, time
request = json.load(sys.stdin)
go = pathlib.Path(request["go"]) if request.get("go") else None
deadline = time.time() + request.get("hold", 0)
while (go is not None and not go.exists()) or time.time() < deadline:
    time.sleep(0.02)
if request.get("fail"):
    print("model exploded", file=sys.stderr)
    sys.exit(3)
key = hashlib.sha256(json.dumps({k: v for k, v in request.items() if k != "result"},
                                sort_keys=True).encode()).hexdigest()[:24]
pathlib.Path(request["out"]).write_bytes(b"ID3")
pathlib.Path(request["result"]).write_text(json.dumps({"key": key, "result": {"duration": 1.0}}))
"""


@pytest.fixture
def script(tmp_path: Path) -> list[str]:
    path = tmp_path / "fake_narrate.py"
    path.write_text(FAKE)
    return [sys.executable, str(path)]


def run(script: list[str], tmp_path: Path, payload: dict, **kw) -> object:
    out = tmp_path / "doc" / "art" / "r.mp3"
    return run_detached(
        script,
        {**payload, "out": str(out)},
        out=out,
        lock_dir=tmp_path,
        marker="fake_narrate.py",
        timeout=kw.pop("timeout", 10),
        poll=0.02,
        **kw,
    )


def test_a_narration_runs_to_its_result_and_frees_the_lock(script, tmp_path: Path):
    finished = run(script, tmp_path, {"text": "hello"})
    assert finished.result == {"duration": 1.0}
    assert (tmp_path / "doc" / "art" / "r.mp3").read_bytes() == b"ID3"
    assert not (tmp_path / LOCK_NAME).exists()


def test_a_failed_narration_says_why_from_its_log(script, tmp_path: Path):
    with pytest.raises(DetachedError, match="model exploded"):
        run(script, tmp_path, {"fail": True})


def test_the_same_request_again_attaches_to_the_running_narration(script, tmp_path: Path):
    """A reload: the API that started the narration is gone, the job comes back, and its
    next run waits for that same process rather than loading a second model."""
    go = tmp_path / "go"
    payload = {"text": "hello", "go": str(go)}
    results: list[object] = []
    first = threading.Thread(target=lambda: results.append(run(script, tmp_path, payload)))
    first.start()
    lock_file = tmp_path / LOCK_NAME
    deadline = time.time() + 5
    while not lock_file.exists() and time.time() < deadline:
        time.sleep(0.01)
    started = json.loads(lock_file.read_text())["pid"]

    second = threading.Thread(target=lambda: results.append(run(script, tmp_path, payload)))
    second.start()
    time.sleep(0.2)
    assert json.loads(lock_file.read_text())["pid"] == started  # no second process
    go.touch()
    first.join(5)
    second.join(5)
    assert [r.result for r in results] == [{"duration": 1.0}] * 2


def test_a_narration_that_runs_too_long_is_killed(script, tmp_path: Path):
    with pytest.raises(DetachedError, match="timed out"):
        run(script, tmp_path, {"hold": 5}, timeout=0.2)
    lock = (
        json.loads((tmp_path / LOCK_NAME).read_text()) if (tmp_path / LOCK_NAME).exists() else None
    )
    assert lock is None


def test_a_narration_that_finished_while_nobody_waited_is_collected(script, tmp_path: Path):
    out = tmp_path / "doc" / "art" / "r.mp3"
    out.parent.mkdir(parents=True)
    payload = {"text": "hello", "out": str(out)}
    out.write_bytes(b"ID3")
    result_path(out).write_text(json.dumps({"key": request_key(payload), "result": {"d": 2}}))
    (tmp_path / LOCK_NAME).write_text(json.dumps({"pid": 999_999, "key": "x", "started": 0}))

    finished = run_detached(
        [sys.executable, "-c", "raise SystemExit('must not start')"],
        payload,
        out=out,
        lock_dir=tmp_path,
        marker="fake_narrate.py",
        timeout=5,
        poll=0.02,
    )
    assert finished.result == {"d": 2}


def test_a_different_narration_holding_the_model_is_waited_for(script, tmp_path: Path):
    blocker = subprocess.Popen(  # noqa: S603  another request's narration
        [*script],
        stdin=subprocess.PIPE,
        start_new_session=True,
    )
    assert blocker.stdin is not None
    blocker.stdin.write(json.dumps({"hold": 0.5, "out": str(tmp_path / "o.mp3"),
                                    "result": str(tmp_path / "o.json")}).encode())  # fmt: skip
    blocker.stdin.close()
    (tmp_path / LOCK_NAME).write_text(json.dumps({"pid": blocker.pid, "key": "other"}))
    naps: list[float] = []

    def nap(seconds: float) -> None:
        naps.append(seconds)
        blocker.poll()  # reap it once it exits, as its own parent would
        time.sleep(0.02)

    finished = run(script, tmp_path, {"text": "mine"}, sleep=nap)
    assert finished.result == {"duration": 1.0}
    assert blocker.returncode == 0
    assert naps, "it waited for the other narration before starting its own"


def test_the_key_ignores_where_the_result_goes():
    assert request_key({"a": 1}) == request_key({"a": 1})
    assert request_key({"a": 1}) != request_key({"a": 2})
    assert os.path.basename(result_path(Path("/x/r.mp3"))) == "r.mp3.result.json"

"""The build agent's `claude` process: started detached, found again after an API restart.

A build runs for up to hours; `fastapi dev` restarts the API on every save. So, as for
narrations (`app.audio.detached`), the process is not the API's child in any way that
matters: its own session (`start_new_session`), stdin from a file, stdout and stderr to
files, and it is never registered with `app.pipeline.processes.terminate_all`. A lock file in
the build directory says which process runs this build:

    <build_dir>/run.lock.json   {pid, marker, started, offset, base_sha, cost_base}

When the job comes back after a restart, the runner reads it: a live pid whose command
line carries the marker (the session id) is attached to and watched; a dead one is
collected from its events file.
"""

import json
import subprocess
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Protocol

from app.audio.detached import _alive
from app.builds.watch import Process

LOCK_NAME = "run.lock.json"
EVENTS_NAME = "events.ndjson"
STDERR_NAME = "stderr.log"
PROMPT_NAME = "kickoff.md"
SURVEY_NAME = "survey.md"  # an existing repository's survey, as the agent got it (§7c)
_TAIL = 2000


@dataclass(frozen=True, slots=True)
class RunLock:
    pid: int
    marker: str  # the claude session id: on the process's command line
    started: float  # epoch seconds: this run's start, for `max_minutes`
    offset: int  # where this run's output starts in events.ndjson (resumes append)
    base_sha: str | None  # HEAD when this run started: its commits come after
    cost_base: float = 0.0  # what earlier runs of the build cost


def read_lock(build_dir: Path) -> RunLock | None:
    try:
        raw = json.loads((build_dir / LOCK_NAME).read_text("utf-8"))
        return RunLock(**raw)
    except (OSError, ValueError, TypeError):
        return None


def write_lock(build_dir: Path, lock: RunLock) -> None:
    path = build_dir / LOCK_NAME
    partial = path.with_name(path.name + ".tmp")
    partial.write_text(json.dumps(asdict(lock)), "utf-8")
    partial.replace(path)


def clear_lock(build_dir: Path) -> None:
    (build_dir / LOCK_NAME).unlink(missing_ok=True)


def alive(pid: int, marker: str) -> bool:
    return pid > 0 and _alive(pid, marker)


class AttachedProcess:
    """A process this API did not start (a previous one did): polled by pid and marker.
    Its exit code is unknown, so a finished one reports 0."""

    def __init__(self, pid: int, marker: str) -> None:
        self._pid = pid
        self.marker = marker
        self._code: int | None = None

    @property
    def pid(self) -> int:
        return self._pid

    def poll(self) -> int | None:
        if self._code is None and not alive(self._pid, self.marker):
            self._code = 0
        return self._code


class Spawner(Protocol):
    def __call__(
        self, argv: Sequence[str], *, cwd: Path, prompt: str, build_dir: Path
    ) -> Process: ...


def spawn_detached(argv: Sequence[str], *, cwd: Path, prompt: str, build_dir: Path) -> Process:
    """Start `claude` in its own session: prompt on stdin (from a file, so a long prompt
    never blocks on a pipe), stream-json appended to events.ndjson, stderr to stderr.log."""
    prompt_file = build_dir / PROMPT_NAME
    prompt_file.write_text(prompt, "utf-8")
    with (
        prompt_file.open("rb") as stdin,
        (build_dir / EVENTS_NAME).open("ab") as stdout,
        (build_dir / STDERR_NAME).open("ab") as stderr,
    ):
        return subprocess.Popen(  # noqa: S603  (argv is built by app.builds.prompting)
            list(argv),
            stdin=stdin,
            stdout=stdout,
            stderr=stderr,
            cwd=cwd,
            start_new_session=True,  # survives the API; the watcher signals its group
        )


def read_from(path: Path, offset: int) -> list[str]:
    """The lines of `path` from byte `offset` (this run's output)."""
    try:
        with path.open("rb") as stream:
            stream.seek(offset)
            return stream.read().decode("utf-8", errors="replace").splitlines()
    except OSError:
        return []


def file_size(path: Path) -> int:
    try:
        return path.stat().st_size
    except OSError:
        return 0


def stderr_tail(build_dir: Path, limit: int = _TAIL) -> str:
    try:
        text = (build_dir / STDERR_NAME).read_text("utf-8", errors="replace")
    except OSError:
        return ""
    return text[-limit:].strip()


def session_started(events: Path, session_id: str) -> bool:
    """True when an earlier run already created this claude session (so `--resume`)."""
    needle = f'"session_id": "{session_id}"'
    compact = f'"session_id":"{session_id}"'
    return any(needle in line or compact in line for line in read_from(events, 0))

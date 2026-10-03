"""The watch loop of a running build (docs/BUILDS.md B6).

Every `tick` seconds the watcher

1. reads the new bytes of `events.ndjson` (whole lines only; it keeps the offset),
2. lists the commits made since the last tick (`git log`) and adds a `commit` event each,
3. pushes when new commits appeared and there is a remote (a failed push is an `error`
   event, retried on the next tick, never fatal); with `defer_push` (`push: at_end`) it
   only notes that a push is due, and `flush_push` pushes once at the end,
   With `confine` (an existing repository's folder, §7c B19) each new commit's files are
   checked (`git diff-tree`): one outside the folder is an `error` event naming the paths;
   in `stop` mode the run stops (stop reason `error`) and nothing more is pushed,
4. persists the progress (`persist`, which answers whether you asked it to stop),
5. enforces the stops the model cannot talk itself past: minutes (and the hard cap),
   commits and *Stop*. A fired stop ends the process group: SIGTERM, a grace period,
   then SIGKILL.

The clock, the sleep, the signal and the persistence are seams, so tests drive it with a
fake clock and a fake process in microseconds. The worker heartbeats the job on its own
thread (`app.jobs.worker.Worker._beat`), so the loop does not.
"""

import contextlib
import logging
import os
import signal
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal, Protocol

from app.builds.events import BuildEvent, now_iso, parse_lines
from app.builds.git import Commit, Git, GitError

logger = logging.getLogger(__name__)

TICK_SECONDS = 5.0
GRACE_SECONDS = 15.0


class Process(Protocol):
    @property
    def pid(self) -> int: ...
    def poll(self) -> int | None: ...


@dataclass(frozen=True, slots=True)
class Limits:
    max_minutes: float
    max_commits: int
    hard_cap_minutes: float = 720


@dataclass(frozen=True, slots=True)
class Signals:
    """What the database said on this tick."""

    stop_requested: bool = False
    detach: bool = False  # the job is no longer ours (handed back): watch no more


@dataclass(slots=True)
class Progress:
    events: list[BuildEvent]
    commits: list[Commit]  # new since the previous tick, oldest first


@dataclass(frozen=True, slots=True)
class Confine:
    """Commits may only touch `folder`; `stop` stops the run when one does not."""

    folder: str
    mode: Literal["warn", "stop"] = "warn"

    def outside(self, paths: list[str]) -> list[str]:
        return [p for p in paths if not p.startswith(f"{self.folder}/")]


@dataclass(slots=True)
class Outcome:
    stop_reason: str | None = None  # a `StopReason` value when a stop fired
    detached: bool = False
    commits: list[Commit] = field(default_factory=list)  # every commit of this run
    exit_code: int | None = None
    error: str | None = None  # why an `error` stop fired (a commit outside the folder)


Persist = Callable[[Progress], Signals]
Kill = Callable[[int, int], None]


def kill_group(pid: int, sig: int) -> None:
    with contextlib.suppress(ProcessLookupError, PermissionError):
        os.killpg(pid, sig)


class EventTail:
    """Reads only what was appended to the events file since the last read."""

    def __init__(self, path: Path, offset: int = 0) -> None:
        self.path = path
        self.offset = offset

    def read(self) -> list[str]:
        try:
            with self.path.open("rb") as stream:
                stream.seek(self.offset)
                chunk = stream.read()
        except OSError:
            return []
        end = chunk.rfind(b"\n")
        if end == -1:  # no complete line yet
            return []
        self.offset += end + 1
        return chunk[: end + 1].decode("utf-8", errors="replace").splitlines()


class Watcher:
    def __init__(
        self,
        *,
        git: Git,
        process: Process,
        events_path: Path,
        base_sha: str | None,
        started: float,
        limits: Limits,
        persist: Persist,
        push: Callable[[], None] | None = None,
        offset: int = 0,
        tick: float = TICK_SECONDS,
        grace: float = GRACE_SECONDS,
        clock: Callable[[], float] = time.time,
        sleep: Callable[[float], None] = time.sleep,
        kill: Kill = kill_group,
        defer_push: bool = False,
        confine: Confine | None = None,
    ) -> None:
        self.git = git
        self.process = process
        self.tail = EventTail(events_path, offset)
        self.base_sha = base_sha
        self.last_sha = base_sha
        self.started = started
        self.limits = limits
        self.persist = persist
        self.push = push
        self.tick = tick
        self.grace = grace
        self.clock = clock
        self.sleep = sleep
        self.kill = kill
        self.defer_push = defer_push
        self.confine = confine
        self.commits: list[Commit] = []
        self._push_pending = False
        self.violation: str | None = None  # the first out-of-folder commit, in `stop` mode

    # -- one tick ------------------------------------------------------------------

    def _new_commits(self) -> list[Commit]:
        try:
            fresh = self.git.log(self.last_sha)
        except GitError as exc:  # e.g. a commit in progress: next tick
            logger.warning("git log failed", extra={"error": str(exc)})
            return []
        if fresh:
            self.last_sha = fresh[-1].sha
            self.commits.extend(fresh)
        return fresh

    def _confined(self, fresh: list[Commit]) -> list[BuildEvent]:
        """An `error` event per new commit that touched files outside the folder."""
        if self.confine is None:
            return []
        events = []
        for c in fresh:
            try:
                outside = self.confine.outside(self.git.changed_paths(c.sha))
            except GitError as exc:
                logger.warning("git diff-tree failed", extra={"error": str(exc)})
                continue
            if not outside:
                continue
            shown = ", ".join(outside[:5]) + (
                f" and {len(outside) - 5} more" if len(outside) > 5 else ""
            )
            text = f"Commit {c.sha[:7]} touched files outside {self.confine.folder}: {shown}"
            events.append(BuildEvent(now_iso(), "error", text))
            if self.confine.mode == "stop" and self.violation is None:
                self.violation = text
        return events

    def _push(self, events: list[BuildEvent]) -> None:
        if self.push is None or not self._push_pending or self.defer_push or self.violation:
            return
        try:
            self.push()
        except Exception as exc:  # retried next tick; the commits are safe locally
            events.append(BuildEvent(now_iso(), "error", f"push failed: {str(exc)[:240]}"))
        else:
            self._push_pending = False

    def step(self) -> Signals:
        """Read, sync, push and persist once. → what the database said."""
        events = parse_lines(self.tail.read())
        fresh = self._new_commits()
        events += [BuildEvent(c.at, "commit", f"{c.sha[:7]} {c.subject}") for c in fresh]
        events += self._confined(fresh)
        self._push_pending = self._push_pending or bool(fresh)
        self._push(events)
        try:
            return self.persist(Progress(events=events, commits=fresh))
        except Exception:  # a missed write is harmless: the next tick writes again
            logger.warning("Persisting build progress failed", exc_info=True)
            return Signals()

    # -- stops -----------------------------------------------------------------------

    def stop_reason(self, signals: Signals) -> str | None:
        if self.violation is not None:
            return "error"
        if signals.stop_requested:
            return "user"
        minutes = (self.clock() - self.started) / 60
        if minutes >= min(self.limits.max_minutes, self.limits.hard_cap_minutes):
            return "max_minutes"
        if len(self.commits) >= self.limits.max_commits:
            return "max_commits"
        return None

    def terminate(self) -> int | None:
        """SIGTERM the process group, wait `grace`, then SIGKILL. → exit code if known."""
        pid = self.process.pid
        self.kill(pid, signal.SIGTERM)
        deadline = self.clock() + self.grace
        while (code := self.process.poll()) is None and self.clock() < deadline:
            self.sleep(min(0.5, self.tick))
        if code is None:
            self.kill(pid, signal.SIGKILL)
            code = self.process.poll()
        return code

    # -- the loop --------------------------------------------------------------------

    def run(self) -> Outcome:
        while True:
            exit_code = self.process.poll()
            signals = self.step()
            if signals.detach:
                return Outcome(detached=True, commits=self.commits)
            if exit_code is not None:
                return Outcome(commits=self.commits, exit_code=exit_code)
            if (reason := self.stop_reason(signals)) is not None:
                logger.info("Build stop fired", extra={"reason": reason, "pid": self.process.pid})
                exit_code = self.terminate()
                self.step()  # the last events and any commit that landed meanwhile
                return Outcome(stop_reason=reason, commits=self.commits, exit_code=exit_code,
                               error=self.violation)  # fmt: skip
            self.sleep(self.tick)

    def flush_push(self) -> None:
        """One last push attempt for commits whose push failed (raises on failure). Nothing
        is pushed after a commit outside the folder stopped the run."""
        if self.push is not None and self._push_pending and self.violation is None:
            self.push()
            self._push_pending = False

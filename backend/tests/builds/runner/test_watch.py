import signal
from pathlib import Path

from app.builds.git import Git
from app.builds.watch import EventTail, Limits, Progress, Signals, Watcher
from tests.builds.runner import ndjson
from tests.builds.runner.conftest import commit_file
from tests.builds.runner.fakes import FakeClock, FakeProcess


class Recorder:
    def __init__(self, stop_after: int | None = None) -> None:
        self.ticks: list[Progress] = []
        self.stop_after = stop_after

    def __call__(self, progress: Progress) -> Signals:
        self.ticks.append(progress)
        stop = self.stop_after is not None and len(self.ticks) >= self.stop_after
        return Signals(stop_requested=stop)

    def events(self) -> list[tuple[str, str]]:
        return [(e.kind, e.text) for t in self.ticks for e in t.events]


def _watcher(repo: Git, tmp_path: Path, clock: FakeClock, proc: FakeProcess, persist,
             *, max_minutes: float = 90, max_commits: int = 30, push=None) -> Watcher:  # fmt: skip
    return Watcher(
        git=repo, process=proc, events_path=tmp_path / "events.ndjson", base_sha=repo.head(),
        started=clock(), limits=Limits(max_minutes=max_minutes, max_commits=max_commits),
        persist=persist, push=push, tick=5, grace=15, clock=clock, sleep=clock.sleep,
        kill=proc.kill,
    )  # fmt: skip


def test_event_tail_reads_whole_lines_once(tmp_path: Path) -> None:
    path = tmp_path / "events.ndjson"
    tail = EventTail(path)
    assert tail.read() == []  # no file yet
    path.write_text('{"a": 1}\n{"b": ')
    assert tail.read() == ['{"a": 1}']
    with path.open("a") as f:
        f.write("2}\n")
    assert tail.read() == ['{"b": 2}']
    assert tail.read() == []


def test_runs_until_the_process_exits_and_syncs_commits(repo: Git, tmp_path: Path) -> None:
    commit_file(repo, "README.md", "seed", "chore: seed repository")
    clock = FakeClock()
    proc = FakeProcess(clock, exit_at=clock() + 12)
    (tmp_path / "events.ndjson").write_text(ndjson.init() + ndjson.tool("Bash", command="ls"))

    def agent_commits_once(_now: float) -> None:
        if not (repo.cwd / "a.py").exists():
            commit_file(repo, "a.py", "1", "feat: a")

    clock.on_sleep.append(agent_commits_once)
    pushes: list[int] = []
    persist = Recorder()

    outcome = _watcher(repo, tmp_path, clock, proc, persist, push=lambda: pushes.append(1)).run()

    assert outcome.stop_reason is None and outcome.exit_code == 0
    assert [c.subject for c in outcome.commits] == ["feat: a"]
    events = persist.events()
    assert events[:2] == [("system", "session started (claude-opus-5-5)"), ("tool", "Bash: ls")]
    assert ("commit", f"{outcome.commits[0].sha[:7]} feat: a") in events
    assert pushes == [1]  # once, for the one new commit
    assert proc.signals == []


def test_a_failed_push_is_an_event_and_retried(repo: Git, tmp_path: Path) -> None:
    commit_file(repo, "README.md", "seed", "chore: seed")
    clock = FakeClock()
    proc = FakeProcess(clock, exit_at=clock() + 11)
    attempts: list[int] = []

    def push() -> None:
        attempts.append(1)
        if len(attempts) == 1:
            raise RuntimeError("network down")

    watcher = _watcher(repo, tmp_path, clock, proc, persist := Recorder(), push=push)
    commit_file(repo, "a.py", "1", "feat: a")
    watcher.run()

    assert len(attempts) == 2
    assert ("error", "push failed: network down") in persist.events()


def test_max_minutes_terminates_the_group(repo: Git, tmp_path: Path) -> None:
    commit_file(repo, "README.md", "seed", "chore: seed")
    clock = FakeClock()
    proc = FakeProcess(clock)  # never exits on its own

    outcome = _watcher(repo, tmp_path, clock, proc, Recorder(), max_minutes=1).run()

    assert outcome.stop_reason == "max_minutes"
    assert proc.signals == [signal.SIGTERM]
    assert clock() - 1_000_000.0 == 60  # stopped on the tick that crossed the limit


def test_a_stubborn_process_gets_sigkill_after_the_grace(repo: Git, tmp_path: Path) -> None:
    commit_file(repo, "README.md", "seed", "chore: seed")
    clock = FakeClock()
    proc = FakeProcess(clock, stubborn=True)

    outcome = _watcher(repo, tmp_path, clock, proc, Recorder(stop_after=1)).run()

    assert outcome.stop_reason == "user"
    assert proc.signals == [signal.SIGTERM, signal.SIGKILL]
    assert clock() - 1_000_000.0 >= 15


def test_max_commits_lets_the_commit_land_then_stops(repo: Git, tmp_path: Path) -> None:
    commit_file(repo, "README.md", "seed", "chore: seed")
    clock = FakeClock()
    proc = FakeProcess(clock)
    made = iter(range(10))
    clock.on_sleep.append(lambda _now: commit_file(repo, f"f{(n := next(made))}.py", "x",
                                                   f"feat: step {n}"))  # fmt: skip

    outcome = _watcher(repo, tmp_path, clock, proc, Recorder(), max_commits=2).run()

    assert outcome.stop_reason == "max_commits"
    assert len(outcome.commits) >= 2
    assert repo.log(outcome.commits[-1].sha) == []  # every landed commit was recorded


def test_detach_returns_without_killing(repo: Git, tmp_path: Path) -> None:
    commit_file(repo, "README.md", "seed", "chore: seed")
    clock = FakeClock()
    proc = FakeProcess(clock)

    outcome = _watcher(repo, tmp_path, clock, proc, lambda _p: Signals(detach=True)).run()

    assert outcome.detached and proc.signals == []


def test_a_persist_failure_does_not_stop_the_loop(repo: Git, tmp_path: Path) -> None:
    commit_file(repo, "README.md", "seed", "chore: seed")
    clock = FakeClock()
    proc = FakeProcess(clock, exit_at=clock() + 6)

    def broken(_progress: Progress) -> Signals:
        raise RuntimeError("db down")

    outcome = _watcher(repo, tmp_path, clock, proc, broken).run()
    assert outcome.exit_code == 0

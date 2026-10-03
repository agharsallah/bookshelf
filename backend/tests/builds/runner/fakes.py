"""Fakes for the watch loop: a clock that moves only when slept, a process it controls."""

import signal
from collections.abc import Callable


class FakeClock:
    def __init__(self, start: float = 1_000_000.0) -> None:
        self.now = start
        self.on_sleep: list[Callable[[float], None]] = []

    def __call__(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.now += seconds
        for hook in self.on_sleep:
            hook(self.now)


class FakeProcess:
    """Runs until `exit_at` (clock time) or a signal; SIGTERM is ignored when `stubborn`."""

    def __init__(self, clock: FakeClock, *, exit_at: float | None = None,
                 stubborn: bool = False, pid: int = 4242) -> None:  # fmt: skip
        self.clock = clock
        self.exit_at = exit_at
        self.stubborn = stubborn
        self.pid = pid
        self.code: int | None = None
        self.signals: list[int] = []

    def poll(self) -> int | None:
        if self.code is None and self.exit_at is not None and self.clock() >= self.exit_at:
            self.code = 0
        return self.code

    def kill(self, pid: int, sig: int) -> None:
        assert pid == self.pid
        self.signals.append(sig)
        if sig == signal.SIGKILL or not self.stubborn:
            self.code = -sig

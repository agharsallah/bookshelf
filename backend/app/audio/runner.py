"""The speech runtime seam: `SpeechRunner.synthesize(request, out) -> SpeechResult`.

`VibeVoiceRunner` runs `scripts/narrate/vibevoice.py` through `uv run --script`, in its own
environment (torch, transformers, diffusers) on its own Python, so none of that enters the
API's dependencies, the same way skills run through the `claude` CLI (D18). The request goes
in as JSON on stdin; the script writes the MP3 to `out` and prints one JSON result line.
`FakeSpeechRunner` stands in for tests.
"""

import json
import logging
import subprocess
import time
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

from app.audio.speech import SpeechRequest
from app.audio.store import Mark
from app.core.config import Settings, get_settings
from app.pipeline.runner import communicate_tracked

logger = logging.getLogger(__name__)

_STDERR_TAIL = 2000


class SpeechError(RuntimeError):
    """The speech model failed (exit code, timeout, unreadable result). The queue retries."""


@dataclass(frozen=True, slots=True)
class SpeechResult:
    duration: float
    sections: tuple[Mark, ...]
    turns: tuple[Mark, ...]
    engine: Mapping[str, Any] = field(default_factory=dict)  # what actually ran
    duration_ms: int = 0


class SpeechRunner(Protocol):
    def engine(self) -> dict[str, Any]:
        """The settings that change the sound (model, steps, guidance, seed): part of the
        render key, so changing them makes a new render instead of reusing the old one."""
        ...

    def synthesize(self, request: SpeechRequest, out: Path) -> SpeechResult: ...


def parse_result(stdout: str, *, duration_ms: int = 0) -> SpeechResult:
    """The script's last stdout line: `{duration, sections: [mark], turns: [mark], engine}`."""
    lines = [line for line in stdout.splitlines() if line.strip()]
    try:
        raw = json.loads(lines[-1])
        return SpeechResult(
            duration=float(raw["duration"]),
            sections=tuple(Mark(**m) for m in raw["sections"]),
            turns=tuple(Mark(**m) for m in raw["turns"]),
            engine=raw.get("engine", {}),
            duration_ms=duration_ms,
        )
    except (IndexError, ValueError, KeyError, TypeError) as exc:
        raise SpeechError(f"unreadable speech result: {stdout[-_STDERR_TAIL:]!r}") from exc


class VibeVoiceRunner:
    """One narration per call, through the isolated `uv run --script` environment."""

    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()

    def engine(self) -> dict[str, Any]:
        s = self._settings
        return {
            "model": s.narrate_model,
            "diffusion_steps": s.narrate_diffusion_steps,
            "guidance_scale": s.narrate_guidance_scale,
            "seed": s.narrate_seed,
        }

    def argv(self) -> list[str]:
        return [
            self._settings.uv_bin,
            "run",
            "--quiet",
            "--script",
            str(self._settings.narrate_script),
        ]

    def synthesize(self, request: SpeechRequest, out: Path) -> SpeechResult:
        s = self._settings
        payload = {
            **request.as_json(),
            **self.engine(),
            "device": s.narrate_device,
            "out": str(out),
        }
        out.parent.mkdir(parents=True, exist_ok=True)
        started = time.monotonic()
        try:
            proc = subprocess.Popen(  # noqa: S603  (argv comes from settings, never from input)
                self.argv(),
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                start_new_session=True,
            )
        except OSError as exc:
            raise SpeechError(f"cannot start {s.uv_bin!r}: {exc}") from exc
        try:
            stdout, stderr = communicate_tracked(
                proc, json.dumps(payload), timeout=s.narrate_timeout_seconds
            )
        except subprocess.TimeoutExpired as exc:
            raise SpeechError(f"narration timed out after {s.narrate_timeout_seconds}s") from exc
        elapsed = int((time.monotonic() - started) * 1000)
        if proc.returncode != 0:
            tail = (stderr or stdout or "")[-_STDERR_TAIL:].strip()
            raise SpeechError(f"narration exited with {proc.returncode}: {tail}")
        if not out.is_file():
            raise SpeechError("narration finished without writing its audio")
        return parse_result(stdout, duration_ms=elapsed)


class FakeSpeechRunner:
    """Writes a stand-in file and a timeline of one second per turn; records requests."""

    def __init__(self, *, fail: Exception | None = None) -> None:
        self.calls: list[SpeechRequest] = []
        self._fail = fail

    def engine(self) -> dict[str, Any]:
        return {"model": "fake-voice-1", "diffusion_steps": 1}

    def synthesize(self, request: SpeechRequest, out: Path) -> SpeechResult:
        self.calls.append(request)
        if self._fail is not None:
            raise self._fail
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(b"ID3fake")
        sections: list[Mark] = []
        turns: list[Mark] = []
        clock = 0.0
        for s, section in enumerate(request.sections):
            start = clock
            for t, _ in enumerate(section.turns):
                turns.append(Mark(start=clock, end=clock + 1, section=s, turn=t))
                clock += 1
            sections.append(Mark(start=start, end=clock, section=s, title=section.title))
        return SpeechResult(clock, tuple(sections), tuple(turns), self.engine(), 1)

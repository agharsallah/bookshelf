"""One preflight check (docs/BUILDS.md B10): shared by `preflight` and `targets` (§7c)."""

from dataclasses import dataclass
from typing import Literal

Level = Literal["error", "warning"]


@dataclass(frozen=True, slots=True)
class PreflightCheck:
    key: str
    ok: bool
    level: Level
    message: str
    fix: str | None = None


def passed(key: str, message: str, level: Level = "error") -> PreflightCheck:
    return PreflightCheck(key=key, ok=True, level=level, message=message)


def failed(key: str, message: str, fix: str, level: Level = "error") -> PreflightCheck:
    return PreflightCheck(key=key, ok=False, level=level, message=message, fix=fix)

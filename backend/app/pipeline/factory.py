"""Which `ModelRunner` a process uses. One setting, every skill and answer call."""

from app.core.config import Settings, get_settings
from app.pipeline.cursor_runner import CursorCliRunner
from app.pipeline.runner import ClaudeCliRunner, ModelRunner


def make_runner(
    *, timeout_seconds: float | None = None, settings: Settings | None = None
) -> ModelRunner:
    """The runtime `settings.model_runtime` names. Claude, unless it is `cursor`."""
    settings = settings or get_settings()
    if settings.model_runtime == "cursor":
        return CursorCliRunner(timeout_seconds=timeout_seconds, settings=settings)
    return ClaudeCliRunner(timeout_seconds=timeout_seconds, settings=settings)

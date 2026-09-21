"""Structured logging with per-request correlation IDs."""

import json
import logging
import sys
from contextvars import ContextVar
from typing import Any

request_id_ctx: ContextVar[str] = ContextVar("request_id", default="-")

_RESERVED = frozenset(logging.LogRecord("", 0, "", 0, "", None, None).__dict__) | {
    "message",
    "asctime",
    "taskName",
}


class JsonFormatter(logging.Formatter):
    """One JSON object per line: greppable locally, parseable by any log backend."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": request_id_ctx.get(),
        }
        payload.update({k: v for k, v in record.__dict__.items() if k not in _RESERVED})
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


class TextFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        record.request_id = request_id_ctx.get()
        return super().format(record)


def configure_logging(level: str = "INFO", *, json_output: bool = True) -> None:
    formatter: logging.Formatter = (
        JsonFormatter()
        if json_output
        else TextFormatter("%(asctime)s %(levelname)-8s [%(request_id)s] %(name)s: %(message)s")
    )
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(formatter)

    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)

    # Uvicorn ships its own handlers; route them through ours so every line is structured.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logger = logging.getLogger(name)
        logger.handlers = []
        logger.propagate = True

    # Access logging is done by our own middleware, with the request id attached.
    logging.getLogger("uvicorn.access").disabled = True

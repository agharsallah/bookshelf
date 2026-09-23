"""Domain errors raised by services that the core error module does not cover.

They subclass `AppError`, so the global handler renders them in the standard envelope.
"""

from typing import Any

from app.core.errors import AppError


class InvalidInputError(AppError):
    """Input that is well-formed JSON but invalid against the stored data (`422`).

    Uses the same `validation_error` code as request-schema failures, so clients handle
    "the body is wrong" in one place whether Pydantic or a service noticed.
    """

    status_code = 422
    code = "validation_error"

    def __init__(self, message: str, *, field: str | None = None, **extra: Any) -> None:
        details = [{"field": field, "message": message, **extra}] if field else []
        super().__init__(message, details)


class UpstreamError(AppError):
    """A remote server we fetched from failed or timed out (`502`)."""

    status_code = 502
    code = "upstream_error"

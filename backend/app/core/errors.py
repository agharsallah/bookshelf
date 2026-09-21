"""Uniform error envelope and global exception handlers.

Every failure leaves the API in the same shape, so clients parse one thing:

    {"error": {"code": "not_found", "message": "...", "details": [...], "request_id": "..."}}

Docs: https://fastapi.tiangolo.com/tutorial/handling-errors/
"""

import logging
from typing import Any

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.logging import request_id_ctx
from app.schemas.common import ErrorBody, ErrorResponse

logger = logging.getLogger(__name__)


class AppError(Exception):
    """Base class for expected, client-visible domain failures."""

    status_code: int = status.HTTP_400_BAD_REQUEST
    code: str = "bad_request"

    def __init__(self, message: str, details: list[dict[str, Any]] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details or []


class NotFoundError(AppError):
    status_code = status.HTTP_404_NOT_FOUND
    code = "not_found"


class ConflictError(AppError):
    status_code = status.HTTP_409_CONFLICT
    code = "conflict"


class PayloadTooLargeError(AppError):
    status_code = status.HTTP_413_CONTENT_TOO_LARGE
    code = "payload_too_large"


class RateLimitedError(AppError):
    status_code = status.HTTP_429_TOO_MANY_REQUESTS
    code = "rate_limited"


_STATUS_CODES: dict[int, str] = {
    status.HTTP_400_BAD_REQUEST: "bad_request",
    status.HTTP_401_UNAUTHORIZED: "unauthorized",
    status.HTTP_403_FORBIDDEN: "forbidden",
    status.HTTP_404_NOT_FOUND: "not_found",
    status.HTTP_405_METHOD_NOT_ALLOWED: "method_not_allowed",
    status.HTTP_409_CONFLICT: "conflict",
    status.HTTP_413_CONTENT_TOO_LARGE: "payload_too_large",
    status.HTTP_422_UNPROCESSABLE_CONTENT: "validation_error",
    status.HTTP_429_TOO_MANY_REQUESTS: "rate_limited",
}


def error_response(
    status_code: int,
    code: str,
    message: str,
    *,
    details: list[dict[str, Any]] | None = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    body = ErrorResponse(
        error=ErrorBody(
            code=code,
            message=message,
            details=details or [],
            request_id=request_id_ctx.get(),
        )
    )
    return JSONResponse(
        status_code=status_code,
        content=jsonable_encoder(body, exclude_none=True),
        headers=headers,
    )


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError) -> JSONResponse:
        return error_response(exc.status_code, exc.code, exc.message, details=exc.details)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        detail = exc.detail if isinstance(exc.detail, str) else "Request failed"
        headers = dict(exc.headers or {}) if isinstance(exc, HTTPException) else None
        return error_response(
            exc.status_code,
            _STATUS_CODES.get(exc.status_code, "http_error"),
            detail,
            headers=headers,
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        # Re-shape Pydantic errors and drop `ctx`, which can echo raw input back to the caller.
        details = [
            {
                "field": ".".join(str(part) for part in err["loc"]),
                "message": err["msg"],
                "type": err["type"],
            }
            for err in exc.errors()
        ]
        return error_response(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "validation_error",
            "Request validation failed",
            details=details,
        )

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        # Log the full traceback, return nothing about it: no stack traces on the wire.
        logger.exception(
            "Unhandled exception",
            extra={"path": request.url.path, "method": request.method, "error": str(exc)},
        )
        return error_response(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "internal_error",
            "An internal error occurred.",
        )

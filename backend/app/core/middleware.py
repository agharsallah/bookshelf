"""Custom ASGI middleware: correlation IDs, access logs, body-size cap, security headers.

Written as raw ASGI middleware rather than `BaseHTTPMiddleware` so that streaming
responses and background tasks are not buffered.

Docs: https://fastapi.tiangolo.com/advanced/middleware/
"""

import logging
import time
import uuid

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.errors import PayloadTooLargeError, error_response
from app.core.logging import request_id_ctx

logger = logging.getLogger("app.access")

REQUEST_ID_HEADER = "x-request-id"

SECURITY_HEADERS: dict[str, str] = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "cross-origin-opener-policy": "same-origin",
    # An API returns JSON only; deny every embedding and script source outright.
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
}

# How much of an over-sized body to read before answering, as a multiple of the limit.
_DRAIN_FACTOR = 8

# Swagger UI / ReDoc load assets from a CDN, so they get a looser policy.
_DOCS_PATHS = frozenset({"/docs", "/redoc", "/docs/oauth2-redirect"})


REQUEST_ID_STATE = "request_id"


class RequestContextMiddleware:
    """Assigns a request id, logs the access line, and stamps security headers."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope["headers"]}
        # Trust an inbound id only if it looks like one; otherwise it is log-injection bait.
        incoming = headers.get(REQUEST_ID_HEADER, "")
        request_id = incoming if _is_safe_id(incoming) else uuid.uuid4().hex
        token = request_id_ctx.set(request_id)
        # Also on the scope: an unhandled exception is answered by Starlette's outermost
        # error middleware, after this context var has been reset (see `core.errors`).
        scope.setdefault("state", {})[REQUEST_ID_STATE] = request_id

        path: str = scope.get("path", "")
        status_code = 500
        started = time.perf_counter()

        async def send_wrapper(message: Message) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
                response_headers = MutableHeaders(scope=message)
                response_headers[REQUEST_ID_HEADER] = request_id
                if path not in _DOCS_PATHS:
                    for key, value in SECURITY_HEADERS.items():
                        response_headers.setdefault(key, value)
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            logger.info(
                "request",
                extra={
                    "method": scope.get("method"),
                    "path": path,
                    "status": status_code,
                    "duration_ms": round((time.perf_counter() - started) * 1000, 2),
                    "client": scope["client"][0] if scope.get("client") else None,
                },
            )
            request_id_ctx.reset(token)


class MaxBodySizeMiddleware:
    """Rejects oversized bodies, including chunked ones that lie about Content-Length."""

    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope["headers"]}
        declared = headers.get("content-length")
        if declared is not None and declared.isdigit() and int(declared) > self.max_bytes:
            await self._reject(scope, receive, send)
            return

        received = 0

        async def receive_capped() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    # Raised inside the route's `await receive()`, so the registered
                    # AppError handler turns it into the standard 413 envelope.
                    logger.warning("Request body exceeded limit", extra={"limit": self.max_bytes})
                    raise PayloadTooLargeError(
                        f"Request body exceeds the {self.max_bytes} byte limit."
                    )
            return message

        await self.app(scope, receive_capped, send)

    async def _reject(self, scope: Scope, receive: Receive, send: Send) -> None:
        await self._drain(receive)
        response = error_response(
            413,
            "payload_too_large",
            f"Request body exceeds the {self.max_bytes} byte limit.",
        )
        await response(scope, receive, send)

    async def _drain(self, receive: Receive) -> None:
        """Read and discard the rejected body so the client can read the 413.

        Answering mid-upload resets the connection and the caller sees a transport
        error instead of the response. Draining is bounded, so this is not a way to
        make the server read an unlimited body.
        """
        discarded = 0
        while discarded <= self.max_bytes * _DRAIN_FACTOR:
            message = await receive()
            if message["type"] != "http.request":
                return
            discarded += len(message.get("body", b""))
            if not message.get("more_body", False):
                return


def _is_safe_id(value: str) -> bool:
    return 8 <= len(value) <= 64 and all(c.isalnum() or c in "-_" for c in value)


__all__ = [
    "REQUEST_ID_HEADER",
    "SECURITY_HEADERS",
    "MaxBodySizeMiddleware",
    "RequestContextMiddleware",
]

"""In-process fixed-window rate limiter.

Good enough for a single-process deployment and for keeping a runaway client or a
loose script from hammering the API. Multi-process or multi-node deployments should
swap `_InMemoryCounter` for Redis; the middleware contract stays the same.
"""

import logging
import secrets
import time
from threading import Lock

from starlette.types import ASGIApp, Receive, Scope, Send

from app.core.errors import error_response

logger = logging.getLogger(__name__)

# Never rate limit liveness checks: a throttled probe reads as a dead process.
EXEMPT_PATHS = frozenset({"/health", "/health/ready", "/docs", "/redoc", "/openapi.json"})


class _InMemoryCounter:
    """`{client: (window_start, hits)}`, pruned lazily to bound memory."""

    def __init__(self, window_seconds: int, max_entries: int = 10_000) -> None:
        self.window = window_seconds
        self.max_entries = max_entries
        self._hits: dict[str, tuple[float, int]] = {}
        self._lock = Lock()

    def hit(self, key: str, now: float) -> tuple[int, float]:
        """Return `(count_in_window, window_reset_epoch)`."""
        with self._lock:
            window_start, count = self._hits.get(key, (now, 0))
            if now - window_start >= self.window:
                window_start, count = now, 0
            count += 1
            self._hits[key] = (window_start, count)
            if len(self._hits) > self.max_entries:
                self._prune(now)
            return count, window_start + self.window

    def _prune(self, now: float) -> None:
        stale = [k for k, (start, _) in self._hits.items() if now - start >= self.window]
        for key in stale:
            del self._hits[key]


class RateLimitMiddleware:
    def __init__(
        self, app: ASGIApp, *, max_requests: int, window_seconds: int, api_key: str | None = None
    ) -> None:
        self.app = app
        self.max_requests = max_requests
        self.counter = _InMemoryCounter(window_seconds)
        self._api_key = api_key.encode() if api_key else None

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or self.max_requests <= 0:
            await self.app(scope, receive, send)
            return
        if scope.get("path", "") in EXEMPT_PATHS:
            await self.app(scope, receive, send)
            return

        key = _client_key(scope, self._api_key)
        now = time.time()
        count, reset_at = self.counter.hit(key, now)

        if count > self.max_requests:
            retry_after = max(1, int(reset_at - now))
            logger.warning("Rate limit exceeded", extra={"client": key, "hits": count})
            response = error_response(
                429,
                "rate_limited",
                "Too many requests. Slow down and retry later.",
                headers={
                    "retry-after": str(retry_after),
                    "x-ratelimit-limit": str(self.max_requests),
                    "x-ratelimit-remaining": "0",
                    "x-ratelimit-reset": str(int(reset_at)),
                },
            )
            await response(scope, receive, send)
            return

        await self.app(scope, receive, send)


def _client_key(scope: Scope, api_key: bytes | None) -> str:
    """Identify the caller by the API key when it presents the real one, else by peer
    address. Any other `X-API-Key` value counts against the address: otherwise a fresh junk
    value per request would get a fresh bucket, i.e. no limit at all (key guessing included).

    `X-Forwarded-For` is deliberately ignored: it is trivially spoofed unless the app
    sits behind a proxy that overwrites it. Run behind a proxy with `--proxy-headers`
    (see https://fastapi.tiangolo.com/advanced/behind-a-proxy/) to get real client IPs.
    """
    for raw_key, raw_value in scope["headers"]:
        if raw_key == b"x-api-key" and api_key and secrets.compare_digest(raw_value, api_key):
            return "key"
    client = scope.get("client")
    return f"ip:{client[0]}" if client else "ip:unknown"

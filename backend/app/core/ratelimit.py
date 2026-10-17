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
        self,
        app: ASGIApp,
        *,
        max_requests: int,
        window_seconds: int,
        api_key: str | None = None,
        proxy_hops: int = 0,
    ) -> None:
        self.app = app
        self.max_requests = max_requests
        self.counter = _InMemoryCounter(window_seconds)
        self._api_key = api_key.encode() if api_key else None
        self._proxy_hops = proxy_hops

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or self.max_requests <= 0:
            await self.app(scope, receive, send)
            return
        if scope.get("path", "") in EXEMPT_PATHS:
            await self.app(scope, receive, send)
            return

        key = _client_key(scope, self._api_key, self._proxy_hops)
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


def _client_key(scope: Scope, api_key: bytes | None, proxy_hops: int = 0) -> str:
    """Identify the caller by the API key when it presents the real one, else by address.
    Any other `X-API-Key` value counts against the address: otherwise a fresh junk value
    per request would get a fresh bucket, i.e. no limit at all (key guessing included).

    The address is the peer's, or behind `proxy_hops` proxies that append to
    `X-Forwarded-For`, the entry that many from the right: everything left of it is the
    client's to write. `scope["client"]` is no help there, since uvicorn's proxy headers
    may already have replaced it with the leftmost, forgeable entry.
    """
    forwarded: list[str] = []
    for raw_key, raw_value in scope["headers"]:
        if raw_key == b"x-api-key" and api_key and secrets.compare_digest(raw_value, api_key):
            return "key"
        if raw_key == b"x-forwarded-for":
            forwarded += [hop.strip() for hop in raw_value.decode("latin-1").split(",")]
    if proxy_hops and len(forwarded) >= proxy_hops:
        return f"ip:{forwarded[-proxy_hops]}"
    client = scope.get("client")
    return f"ip:{client[0]}" if client else "ip:unknown"

"""Application factory and middleware wiring.

Run locally:  `uv run fastapi dev app/main.py`
"""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.api.router import api_router, database_router
from app.api.routes import health
from app.api.routes.snapshots import UPLOAD_PATH as SNAPSHOT_UPLOAD_PATH
from app.core import lifecycle
from app.core.config import Settings, get_settings
from app.core.docs import DESCRIPTION, TAGS_METADATA
from app.core.errors import register_exception_handlers
from app.core.logging import configure_logging
from app.core.middleware import MaxBodySizeMiddleware, RequestContextMiddleware
from app.core.ratelimit import RateLimitMiddleware
from app.core.security import API_KEY_HEADER
from app.jobs.runners import Runners
from app.retrieval.client import close_client

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Startup/shutdown hooks. https://fastapi.tiangolo.com/advanced/events/

    The API runs a pipeline worker on a background thread, so queued jobs run without a
    second process; on shutdown it hands unfinished jobs back to the queue. With embedded
    Qdrant the API owns the store, so it also runs `embed` jobs (on one more thread) until
    shutdown. Nothing here connects to Qdrant: startup never waits on it, and a missing
    store only degrades search.
    """
    settings: Settings = app.state.settings
    # Re-applied here: uvicorn installs its own handlers after import time, so the
    # configuration done in `create_app()` would otherwise be overwritten.
    configure_logging(settings.log_level, json_output=settings.log_json)
    logger.info(
        "Application started",
        extra={
            "environment": settings.environment.value,
            "docs_enabled": settings.docs_enabled,
            "auth_required": settings.auth_required,
        },
    )
    restore_signals = lifecycle.install()  # SSE streams end as soon as shutdown begins
    runners = Runners(settings)
    app.state.runners = runners  # Settings → Database restarts them on a switch
    runners.start()
    try:
        yield
    finally:
        restore_signals()
        runners.stop()  # jobs back to the queue; `claude` and speech killed
        close_client()  # release the embedded store's lock before a reload reopens it
        logger.info("Application stopped")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level, json_output=settings.log_json)

    app = FastAPI(
        title=settings.project_name,
        version=settings.version,
        summary="Track reads, learnings, briefs, and distillations.",
        description=DESCRIPTION,
        openapi_tags=TAGS_METADATA,
        lifespan=lifespan,
        # Docs off in production by default; they are not a security control, but
        # there is no reason to publish the surface map either.
        # https://fastapi.tiangolo.com/how-to/conditional-openapi/
        openapi_url="/openapi.json" if settings.docs_enabled else None,
        docs_url="/docs" if settings.docs_enabled else None,
        redoc_url="/redoc" if settings.docs_enabled else None,
        contact={"name": "Bookshelf", "url": "https://github.com/"},
        license_info={"name": "MIT", "identifier": "MIT"},
    )
    app.state.settings = settings

    # Middleware runs outermost-first, so this list reads top-down as the request path:
    # context/logging -> host check -> CORS -> rate limit -> body cap -> gzip -> routes.
    app.add_middleware(GZipMiddleware, minimum_size=1000)
    app.add_middleware(
        MaxBodySizeMiddleware,
        max_bytes=settings.max_request_bytes,
        limits={f"{settings.api_prefix}{SNAPSHOT_UPLOAD_PATH}": settings.snapshot_max_bytes},
    )
    app.add_middleware(
        RateLimitMiddleware,
        max_requests=settings.rate_limit_requests,
        window_seconds=settings.rate_limit_window_seconds,
        api_key=settings.api_key,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", API_KEY_HEADER, "X-Request-ID"],
        expose_headers=["X-Request-ID"],
        max_age=600,
    )
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_hosts)
    app.add_middleware(RequestContextMiddleware)

    register_exception_handlers(app)

    app.include_router(health.router)
    app.include_router(api_router, prefix=settings.api_prefix)
    if settings.database_admin:
        app.include_router(database_router, prefix=settings.api_prefix)
    return app


app = create_app()

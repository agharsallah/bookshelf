"""Liveness and readiness probes. Unauthenticated and never rate limited."""

from fastapi import APIRouter, status
from sqlalchemy import text

from app.api.deps import SessionDep
from app.core.config import Settings, get_settings
from app.core.errors import error_response
from app.schemas.common import HealthResponse, ReadinessResponse

router = APIRouter(tags=["health"])


@router.get(
    "/health",
    response_model=HealthResponse,
    summary="Liveness probe",
    description="Returns as long as the process is up. Does not touch the database.",
)
async def health() -> HealthResponse:
    settings: Settings = get_settings()
    return HealthResponse(
        status="ok",
        version=settings.version,
        environment=settings.environment.value,
    )


def qdrant_status() -> tuple[str, str | None]:
    """`("ok", None)` when Qdrant answers, else `("unavailable", reason)`. Opens the shared
    client on first use (lazily: the API never waits on Qdrant at startup)."""
    from app.retrieval.collections import QdrantUnavailableError, open_client, probe

    try:
        reason = probe(open_client())
    except QdrantUnavailableError as exc:
        reason = str(exc)[:300]
    return ("ok", None) if reason is None else ("unavailable", reason)


@router.get(
    "/health/ready",
    response_model=ReadinessResponse,
    summary="Readiness probe",
    description=(
        "`503` when the database does not answer. Qdrant is reported separately: when it is "
        "unreachable the instance is `degraded` (`200`), since only vector search needs it."
    ),
    responses={503: {"description": "The database is unavailable."}},
)
def readiness(session: SessionDep):  # type: ignore[no-untyped-def]
    try:
        session.exec(text("SELECT 1"))  # type: ignore[call-overload]
    except Exception:
        return error_response(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "not_ready",
            "Database is unavailable.",
        )
    qdrant, reason = qdrant_status()
    return ReadinessResponse(
        status="ready" if qdrant == "ok" else "degraded",
        database="ok",
        qdrant=qdrant,
        qdrant_error=reason,
    )

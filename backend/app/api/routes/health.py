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


@router.get(
    "/health/ready",
    response_model=ReadinessResponse,
    summary="Readiness probe",
    description="Verifies the database answers before declaring the instance ready for traffic.",
    responses={503: {"description": "A dependency is unavailable."}},
)
async def readiness(session: SessionDep):  # type: ignore[no-untyped-def]
    try:
        session.exec(text("SELECT 1"))  # type: ignore[call-overload]
    except Exception:
        return error_response(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "not_ready",
            "Database is unavailable.",
        )
    return ReadinessResponse(status="ready", database="ok")

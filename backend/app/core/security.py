"""API-key authentication for mutating endpoints.

A single shared key is the right size of lock for a personal service. It is declared
with `APIKeyHeader` so the padlock button in `/docs` works and OpenAPI advertises it.
"""

import secrets

from fastapi import Depends, HTTPException, status
from fastapi.security import APIKeyHeader

from app.core.config import Settings, get_settings

API_KEY_HEADER = "X-API-Key"

api_key_scheme = APIKeyHeader(
    name=API_KEY_HEADER,
    auto_error=False,
    description="Shared secret required for any write operation.",
)


async def require_api_key(
    presented: str | None = Depends(api_key_scheme),
    settings: Settings = Depends(get_settings),
) -> None:
    """Guard dependency for write routes. No-op when no key is configured locally."""
    if not settings.auth_required:
        return

    expected = settings.api_key
    if not expected:
        # `Settings` refuses to build in production without a key, so this is a
        # misconfigured non-production environment: fail closed rather than open.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication is required but no API key is configured.",
        )

    # Constant-time compare: a plain `==` leaks the key one byte at a time.
    if presented is None or not secrets.compare_digest(presented, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid API key.",
            headers={"WWW-Authenticate": API_KEY_HEADER},
        )

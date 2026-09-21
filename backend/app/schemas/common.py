"""Envelopes shared by every endpoint: errors, pagination, health."""

from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field


class ErrorBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: Annotated[str, Field(description="Stable, machine-readable error code.")]
    message: Annotated[str, Field(description="Human-readable explanation.")]
    details: Annotated[
        list[dict[str, Any]],
        Field(default_factory=list, description="Per-field problems, for validation errors."),
    ]
    request_id: Annotated[str, Field(description="Correlation id, echoed in `X-Request-ID`.")]


class ErrorResponse(BaseModel):
    """The single error shape returned by every failing request."""

    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={
            "examples": [
                {
                    "error": {
                        "code": "not_found",
                        "message": "Book 42 does not exist.",
                        "details": [],
                        "request_id": "8f14e45fceea167a5a36dedd4bea2543",
                    }
                }
            ]
        },
    )

    error: ErrorBody


class Page[T](BaseModel):
    """Offset pagination. `total` is the unfiltered-by-page match count."""

    items: list[T]
    total: Annotated[int, Field(ge=0, description="Total matching records.")]
    limit: Annotated[int, Field(ge=1, description="Page size that was applied.")]
    offset: Annotated[int, Field(ge=0, description="Records skipped.")]


class HealthResponse(BaseModel):
    status: Annotated[str, Field(examples=["ok"])]
    version: str
    environment: str


class ReadinessResponse(BaseModel):
    status: Annotated[str, Field(examples=["ready"])]
    database: Annotated[str, Field(examples=["ok"])]

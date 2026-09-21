"""Application settings, loaded from environment variables / `.env`.

Docs: https://fastapi.tiangolo.com/advanced/settings/
"""

from enum import StrEnum
from functools import lru_cache
from typing import Annotated, Literal

from pydantic import Field, computed_field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Environment(StrEnum):
    LOCAL = "local"
    STAGING = "staging"
    PRODUCTION = "production"
    TEST = "test"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_prefix="BOOKSHELF_",
        extra="ignore",
        frozen=True,
    )

    # --- Identity -------------------------------------------------------
    project_name: str = "Bookshelf API"
    version: str = "0.1.0"
    environment: Environment = Environment.LOCAL
    api_prefix: str = "/api/v1"

    # --- Persistence ----------------------------------------------------
    database_url: str = "sqlite:///./bookshelf.db"
    database_echo: bool = False

    # --- Guardrails: network --------------------------------------------
    # `NoDecode` keeps pydantic-settings from JSON-parsing these, so the validator
    # below can accept a plain comma-separated string from `.env`.
    cors_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["http://localhost:4321"]
    )
    allowed_hosts: Annotated[list[str], NoDecode] = Field(default_factory=lambda: ["*"])

    # --- Guardrails: request limits --------------------------------------
    max_request_bytes: Annotated[int, Field(gt=0)] = 1 * 1024 * 1024
    rate_limit_requests: Annotated[int, Field(ge=0)] = 120
    rate_limit_window_seconds: Annotated[int, Field(gt=0)] = 60

    # --- Guardrails: auth -------------------------------------------------
    # When set, every mutating request must send `X-API-Key`. Required outside local/test.
    api_key: str | None = None

    # --- Observability ----------------------------------------------------
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    log_json: bool = True

    # --- Docs -------------------------------------------------------------
    # Docs are not a security boundary, but there is no reason to publish them by default.
    # https://fastapi.tiangolo.com/how-to/conditional-openapi/
    enable_docs: bool | None = None

    @field_validator("cors_origins", "allowed_hosts", mode="before")
    @classmethod
    def _split_csv(cls, value: object) -> object:
        """Accept `a,b` as well as a JSON list, so plain `.env` files stay readable."""
        if isinstance(value, str) and not value.startswith("["):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @model_validator(mode="after")
    def _production_must_be_locked_down(self) -> "Settings":
        """Fail at startup rather than serving an unauthenticated production API."""
        if self.environment is Environment.PRODUCTION:
            if not self.api_key:
                raise ValueError("BOOKSHELF_API_KEY is required when ENVIRONMENT=production")
            if "*" in self.allowed_hosts:
                raise ValueError("BOOKSHELF_ALLOWED_HOSTS must be explicit in production")
            if "*" in self.cors_origins:
                raise ValueError("BOOKSHELF_CORS_ORIGINS must be explicit in production")
        return self

    @computed_field  # type: ignore[prop-decorator]
    @property
    def is_production(self) -> bool:
        return self.environment is Environment.PRODUCTION

    @computed_field  # type: ignore[prop-decorator]
    @property
    def docs_enabled(self) -> bool:
        if self.enable_docs is not None:
            return self.enable_docs
        return not self.is_production

    @computed_field  # type: ignore[prop-decorator]
    @property
    def auth_required(self) -> bool:
        """Writes are locked down whenever an API key is configured, always in production."""
        return self.api_key is not None or self.is_production


@lru_cache
def get_settings() -> Settings:
    """Cached so the `.env` file is read once, not per request."""
    return Settings()

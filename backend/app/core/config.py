"""Application settings, loaded from environment variables / `.env`.

Docs: https://fastapi.tiangolo.com/advanced/settings/
"""

from enum import StrEnum
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import AliasChoices, Field, computed_field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Environment(StrEnum):
    LOCAL = "local"
    STAGING = "staging"
    PRODUCTION = "production"
    TEST = "test"


# backend/app/core/config.py -> repo root
REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        # Later files win: the shared frontend/.env (see its header), then backend/.env.
        env_file=(REPO_ROOT / "frontend" / ".env", ".env"),
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
    # Postgres only (JSONB, arrays, FTS, SKIP LOCKED). Default: `scripts/pg-local.sh`.
    database_url: str = "postgresql+psycopg://bookshelf@127.0.0.1:54329/bookshelf"
    database_echo: bool = False

    # --- Files (D13) -----------------------------------------------------
    library_dir: Path = REPO_ROOT / "library"  # originals, ingested by path, never mutated
    media_dir: Path = REPO_ROOT / ".media"  # derived: figure crops, rendered pages
    exports_dir: Path = REPO_ROOT / "exports"  # derived: .md / .json / .csv bundles
    skills_dir: Path = REPO_ROOT / "skills"

    # --- Qdrant (§10) -----------------------------------------------------
    # With a URL: remote cluster. Without: embedded on-disk store at `qdrant_path`.
    qdrant_url: str | None = Field(
        default=None, validation_alias=AliasChoices("BOOKSHELF_QDRANT_URL", "QDRANT_URL")
    )
    qdrant_api_key: str | None = Field(
        default=None, validation_alias=AliasChoices("BOOKSHELF_QDRANT_API_KEY", "QDRANT_API_KEY")
    )
    qdrant_path: Path = REPO_ROOT / ".qdrant"
    qdrant_collection_prefix: str = ""  # tests set this so they never touch real collections
    dense_model: str = "BAAI/bge-small-en-v1.5"
    sparse_model: str = "Qdrant/bm25"
    rerank_model: str = "Xenova/ms-marco-MiniLM-L-6-v2"

    # --- Model runtime (D18) ---------------------------------------------
    claude_bin: str = "claude"
    claude_timeout_seconds: Annotated[int, Field(gt=0)] = 900
    worker_concurrency: Annotated[int, Field(ge=1, le=8)] = 2
    worker_poll_seconds: Annotated[float, Field(gt=0)] = 2.0
    # Embedded Qdrant (no `qdrant_url`) can be opened by one process only, so the API runs
    # `embed` jobs itself (`app.jobs.embedded`). Off: nothing embeds until a URL is set.
    api_embed_runner: bool = True
    # Run ceiling (§14): per-document cap on CLI runs before the document is paused.
    max_runs_per_document: Annotated[int, Field(ge=1)] = 400

    # --- Idea graph (§11) ---------------------------------------------------
    # Concept dedup: cosine similarity that nominates a pair for the model to confirm, and
    # the most pairs one dedup job may send to the model.
    concept_dedup_threshold: Annotated[float, Field(gt=0, le=1)] = 0.88
    concept_dedup_max_pairs: Annotated[int, Field(ge=1)] = 20

    # --- Guardrails: network --------------------------------------------
    # `NoDecode` keeps pydantic-settings from JSON-parsing these, so the validator
    # below can accept a plain comma-separated string from `.env`.
    cors_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["http://localhost:4321"]
    )
    allowed_hosts: Annotated[list[str], NoDecode] = Field(default_factory=lambda: ["*"])

    # --- Guardrails: request limits --------------------------------------
    max_request_bytes: Annotated[int, Field(gt=0)] = 4 * 1024 * 1024
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

    @field_validator("qdrant_url", "qdrant_api_key", "api_key", mode="before")
    @classmethod
    def _blank_is_unset(cls, value: object) -> object:
        """`KEY=` in a .env file means "not configured", not "the empty string"."""
        return None if isinstance(value, str) and not value.strip() else value

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

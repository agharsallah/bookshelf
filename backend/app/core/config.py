"""Application settings, loaded from environment variables / `.env`.

Docs: https://fastapi.tiangolo.com/advanced/settings/
"""

from enum import StrEnum
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Any, Literal
from urllib.parse import quote

from pydantic import AliasChoices, Field, computed_field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Environment(StrEnum):
    LOCAL = "local"
    STAGING = "staging"
    PRODUCTION = "production"
    TEST = "test"


class Effort(StrEnum):
    """How hard the model thinks (`claude --effort`), set per tier (D16)."""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    XHIGH = "xhigh"
    MAX = "max"


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
    # `database_url` is the main database (Supabase in a real setup). `local_database_url` is
    # the cluster on this computer; when they differ, Settings → Database switches which one
    # the app reads and writes (`app/db/targets.py`, kept in `database_target_file`) and syncs
    # one into the other (`app/db/sync.py`).
    database_url: str = "postgresql+psycopg://bookshelf@127.0.0.1:54329/bookshelf"
    # A Postgres server of your own (a VM, say) by libpq's variables, unprefixed: when `PGHOST`
    # is set they make `database_url` (`_database_url_from_pg`), ahead of BOOKSHELF_DATABASE_URL.
    pghost: str | None = Field(default=None, validation_alias="PGHOST")
    pgport: Annotated[int, Field(gt=0)] = Field(default=5432, validation_alias="PGPORT")
    pgdatabase: str | None = Field(default=None, validation_alias="PGDATABASE")
    pguser: str | None = Field(default=None, validation_alias="PGUSER")
    pgpassword: str | None = Field(default=None, validation_alias="PGPASSWORD", repr=False)
    pgsslmode: str | None = Field(default=None, validation_alias="PGSSLMODE")
    local_database_url: str = "postgresql+psycopg://bookshelf@127.0.0.1:54329/bookshelf"
    database_target_file: Path = REPO_ROOT / ".database-target"
    database_backups_dir: Path = REPO_ROOT / ".backups" / "database"  # before a sync overwrites
    # Snapshots (`app/db/snapshot.py`): the last one made here, and a restore's working files
    # and the folders it replaced. Keep it on the same disk as the library: folders move in.
    snapshots_dir: Path = REPO_ROOT / ".backups" / "snapshots"
    # The largest snapshot a restore accepts (the general request cap does not apply to it).
    snapshot_max_bytes: Annotated[int, Field(gt=0)] = 50 * 1024**3
    database_echo: bool = False
    # The `/database` routes (Settings → Database, snapshots). Off for a public deployment such
    # as the demo: they would publish the database's host and hand out the whole shelf.
    database_admin: bool = True

    # --- Files (D13) -----------------------------------------------------
    library_dir: Path = REPO_ROOT / "library"  # originals, ingested by path, never mutated
    media_dir: Path = REPO_ROOT / ".media"  # derived: figure crops, rendered pages
    exports_dir: Path = REPO_ROOT / "exports"  # derived: .md / .json / .csv bundles
    skills_dir: Path = REPO_ROOT / "skills"
    audio_dir: Path = REPO_ROOT / ".audio"  # derived: narrations (app/audio/store.py)
    # Reference clips: built-in samples are cached here, your own go in `custom/`.
    voices_dir: Path = REPO_ROOT / ".audio" / "voices"
    # Derived: one JSON-lines log per job, what it did as it happened (app/telemetry/run_log.py).
    run_logs_dir: Path = REPO_ROOT / ".run-logs"
    run_log_days: Annotated[int, Field(ge=1)] = 14

    # --- Qdrant (§10) -----------------------------------------------------
    # With a URL: remote cluster. Without: embedded on-disk store at `qdrant_path`.
    qdrant_url: str | None = Field(
        default=None, validation_alias=AliasChoices("BOOKSHELF_QDRANT_URL", "QDRANT_URL")
    )
    qdrant_api_key: str | None = Field(
        default=None, validation_alias=AliasChoices("BOOKSHELF_QDRANT_API_KEY", "QDRANT_API_KEY")
    )
    # Per request, remote only. qdrant-client's 5 s default is too short for a 64-point
    # upsert with `wait=True` on a small cloud cluster (embed jobs timed out on it).
    qdrant_timeout_seconds: Annotated[int, Field(gt=0)] = 60
    qdrant_path: Path = REPO_ROOT / ".qdrant"
    qdrant_collection_prefix: str = ""  # tests set this so they never touch real collections
    # False: discovery and synthesis queries answer `unavailable` without opening Qdrant or
    # loading a model. For a deployment with no index, where `/search` needs no API key and
    # each embedding model load is memory a small instance does not have.
    vector_search: bool = True
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
    # The API also runs a pipeline worker (`app.jobs.background`), so starting the API is
    # enough for queued jobs to run. Off: run `python -m app.jobs.worker` yourself.
    api_worker: bool = True
    # Run ceiling (§14): per-document cap on CLI runs before the document is paused.
    max_runs_per_document: Annotated[int, Field(ge=1)] = 400
    # Model ladder overrides (D16): a `claude --model` alias or full name per tier. Unset
    # keeps the ladder in `app/pipeline/models.py`; e.g. all three `haiku` for a cheap run.
    model_explore: str | None = None
    model_distil: str | None = None
    model_reason: str | None = None
    # Effort per tier (`claude --effort`: low, medium, high, xhigh, max); blank keeps
    # medium. Validated here: the CLI ignores a bad value and falls back to its own default.
    effort_explore: Effort = Effort.MEDIUM
    effort_distil: Effort = Effort.MEDIUM
    effort_reason: Effort = Effort.MEDIUM

    # --- Speech runtime (app/audio) ----------------------------------------
    # Narrations run `narrate_script` with `uv run --script`: VibeVoice in its own env.
    uv_bin: str = "uv"
    narrate_script: Path = REPO_ROOT / "scripts" / "narrate" / "vibevoice.py"
    narrate_model: str = "vibevoice/VibeVoice-1.5B-hf"  # or vibevoice/VibeVoice-7B-hf
    narrate_device: Literal["auto", "cuda", "mps", "cpu"] = "auto"
    # More diffusion steps: cleaner audio, slower. Guidance: how closely it follows the voice.
    narrate_diffusion_steps: Annotated[int, Field(ge=2, le=50)] = 10
    narrate_guidance_scale: Annotated[float, Field(ge=1, le=3)] = 1.3
    narrate_seed: int = 42
    narrate_timeout_seconds: Annotated[int, Field(gt=0)] = 6 * 3600
    # Narration holds gigabytes of model on the GPU, so the API runs `narrate` jobs on one
    # slot of their own (`app.jobs.narration`) and the pipeline workers leave them alone.
    api_narrate_runner: bool = True

    # --- Builds (docs/BUILDS.md) --------------------------------------------
    # Each build's checkout lives in `<build_workspace>/<build-id>/`, outside this repo
    # (`claude` reads every parent CLAUDE.md). The agent never runs `gh`; the runner does.
    build_workspace: Path = Path.home() / ".bookshelf" / "builds"
    gh_bin: str = "gh"
    git_bin: str = "git"
    # The longest a build may run, whatever its stops say.
    build_hard_cap_minutes: Annotated[int, Field(ge=5, le=24 * 60)] = 720
    # A build run is one long agent process, so the API runs `build_run` jobs on one slot of
    # their own (like narration) and the pipeline workers leave them alone.
    api_build_runner: bool = True

    # --- Idea graph (§11) ---------------------------------------------------
    # Concept dedup: cosine similarity that nominates a pair for the model to confirm, and
    # the most pairs one dedup job may send to the model.
    concept_dedup_threshold: Annotated[float, Field(gt=0, le=1)] = 0.88
    concept_dedup_max_pairs: Annotated[int, Field(ge=1)] = 20
    # Bridges: cosine that nominates a cross-book pair for `relate-concepts` (below the dedup
    # threshold: above it the pair is a merge question), and the most pairs one job may send.
    # Measured on bge-small: cross-book concept pairs median 0.53, the closest ~0.67.
    concept_bridge_threshold: Annotated[float, Field(gt=0, le=1)] = 0.62
    concept_bridge_max_pairs: Annotated[int, Field(ge=1)] = 8
    # Claim tracker (docs/PAPERS.md §5): cosine that nominates a cross-paper claim pair for
    # `relate-claims`, and the most pairs one relate_claims job may send. Measured on
    # bge-small: a contradicting pair on the same benchmark 0.62, two results on the same
    # benchmark 0.61, unrelated results 0.49; topical neighbours reach 0.75 (the model says
    # `none`, stored rejected, so each pair costs one call ever).
    claim_relate_threshold: Annotated[float, Field(gt=0, le=1)] = 0.6
    claim_relate_max_pairs: Annotated[int, Field(ge=1)] = 12

    # --- Papers: external metadata (docs/PAPERS.md P7) ---------------------
    # OpenAlex is asked on demand only. `mailto` joins the polite pool; an API key (free at
    # openalex.org) lifts the anonymous limits. Both optional.
    openalex_url: str = "https://api.openalex.org"
    openalex_mailto: str | None = None
    openalex_api_key: str | None = None
    # Optional GROBID service (P9, e.g. http://localhost:8070): when set, paper_structure takes
    # header metadata and references from it instead of the PyMuPDF heuristics.
    grobid_url: str | None = None

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
    # Proxies in front of the app that append to `X-Forwarded-For` (Render: 1). The limiter
    # then counts the entry that many from the right, the last one a client cannot forge.
    # 0: the peer address. Uvicorn's `--forwarded-allow-ips` does not do: with `*` it takes
    # the leftmost entry, which the client writes.
    rate_limit_proxy_hops: Annotated[int, Field(ge=0)] = 0

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

    @model_validator(mode="before")
    @classmethod
    def _database_url_from_pg(cls, data: Any) -> Any:
        """`PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD` (and `PGSSLMODE`) →
        `database_url`. Never under tests: their database is set by `tests/conftest.py`, and a
        `PGHOST` in `.env` must not send them to a real server."""
        if not isinstance(data, dict):
            return data
        host = str(data.get("PGHOST") or "").strip()
        if not host or str(data.get("environment", "")).strip().lower() == Environment.TEST:
            return data
        user = quote(str(data.get("PGUSER") or "postgres"), safe="")
        password = str(data.get("PGPASSWORD") or "")
        auth = f"{user}:{quote(password, safe='')}" if password else user
        port = str(data.get("PGPORT") or "").strip() or "5432"
        name = quote(str(data.get("PGDATABASE") or "").strip() or user, safe="")
        sslmode = str(data.get("PGSSLMODE") or "").strip()
        query = f"?sslmode={quote(sslmode, safe='')}" if sslmode else ""
        url = f"postgresql+psycopg://{auth}@{host}:{port}/{name}{query}"
        return {**data, "database_url": url}

    @field_validator("cors_origins", "allowed_hosts", mode="before")
    @classmethod
    def _split_csv(cls, value: object) -> object:
        """Accept `a,b` as well as a JSON list, so plain `.env` files stay readable."""
        if isinstance(value, str) and not value.startswith("["):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @field_validator(
        "qdrant_url", "qdrant_api_key", "api_key", "model_explore", "model_distil",
        "model_reason", "openalex_mailto", "openalex_api_key", "grobid_url", mode="before",
    )  # fmt: skip
    @classmethod
    def _blank_is_unset(cls, value: object) -> object:
        """`KEY=` in a .env file means "not configured", not "the empty string"."""
        return None if isinstance(value, str) and not value.strip() else value

    @field_validator("effort_explore", "effort_distil", "effort_reason", mode="before")
    @classmethod
    def _blank_effort_is_medium(cls, value: object) -> object:
        """`BOOKSHELF_EFFORT_<TIER>=` keeps the default rather than failing validation."""
        return (
            Effort.MEDIUM
            if value is None or (isinstance(value, str) and not value.strip())
            else value
        )

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

"""Wire shapes for Settings → Database (`/database`)."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from app.db.targets import DatabaseTarget

SyncState = Literal["idle", "running", "done", "failed"]


class DatabaseCounts(BaseModel):
    documents: int
    notes: int
    artifacts: int
    collections: int
    running_jobs: int
    last_change: datetime | None


class DatabaseTargetPublic(BaseModel):
    """One of the two databases, as reached just now."""

    target: DatabaseTarget
    label: str
    host: str  # host:port/name, never the user or password
    active: bool
    reachable: bool
    error: str | None = None
    # Migrations this database has not applied yet (applied before a switch or sync touches
    # it); always 0 for a Supabase database, which applies its own.
    pending_migrations: int = 0
    counts: DatabaseCounts | None = None


class SyncProgress(BaseModel):
    state: SyncState = "idle"
    source: DatabaseTarget | None = None
    dest: DatabaseTarget | None = None
    step: str = ""
    table: str | None = None
    tables_done: int = 0
    tables_total: int = 0
    rows: int = 0
    backup_path: str | None = None
    error: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None


class DatabaseStatus(BaseModel):
    """Both databases side by side, which one the app uses, and the last (or current) sync."""

    available: bool  # false: only one database is configured, nothing to switch or sync
    active: DatabaseTarget
    targets: list[DatabaseTargetPublic]
    # What would stop a copy between them (tables or columns one side lacks); empty is good.
    schema_problems: list[str]
    can_back_up: bool  # pg_dump is installed
    sync: SyncProgress


class SwitchRequest(BaseModel):
    target: DatabaseTarget


class SyncRequest(BaseModel):
    """Copy `source` over the other database. `backup` dumps the other one first."""

    source: DatabaseTarget
    backup: bool = True

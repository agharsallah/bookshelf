"""Wire shapes for Settings → Database → Snapshot (`/database/snapshot`)."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel

SnapshotState = Literal["idle", "running", "done", "failed"]
SnapshotAction = Literal["export", "restore"]


class SnapshotProgress(BaseModel):
    state: SnapshotState = "idle"
    action: SnapshotAction | None = None
    step: str = ""
    done: int = 0  # tables and files handled so far
    total: int = 0
    rows: int = 0  # restored
    # A restore's safety copies: the database (pg_dump, when asked) and the replaced folders.
    backup_path: str | None = None
    kept_path: str | None = None
    reindex_job: uuid.UUID | None = None  # the `embed` rebuild a restore queues
    error: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None


class SnapshotFile(BaseModel):
    """The snapshot last made here, ready to download."""

    name: str
    size_bytes: int
    created_at: datetime
    documents: int
    files: int


class SnapshotStatus(BaseModel):
    database: str  # the label of the database a snapshot reads and a restore replaces
    can_back_up: bool  # pg_dump is installed
    max_bytes: int  # the largest snapshot a restore accepts
    latest: SnapshotFile | None
    progress: SnapshotProgress

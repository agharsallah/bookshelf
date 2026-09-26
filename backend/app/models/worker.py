"""ORCHESTRATION: one row per live worker process (see app/jobs/presence.py)."""

import uuid
from datetime import datetime

from sqlalchemy import ARRAY, Column, Text
from sqlmodel import Field, SQLModel

from app.models._columns import timestamptz, utcnow


class WorkerRow(SQLModel, table=True):
    __tablename__ = "workers"

    id: uuid.UUID = Field(primary_key=True)
    name: str  # host:pid (and where it runs), for humans
    kinds: list[str] = Field(default_factory=list, sa_column=Column(ARRAY(Text), nullable=False))
    concurrency: int
    running: int = 0
    started_at: datetime = Field(default_factory=utcnow, sa_column=timestamptz())
    seen_at: datetime = Field(default_factory=utcnow, sa_column=timestamptz())

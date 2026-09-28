"""HUMAN layer: the one row of server-side settings (see `services/app_settings.py`)."""

from datetime import datetime
from typing import Any

from sqlmodel import Field, SQLModel

from app.models._columns import jsonb, timestamptz, utcnow

SINGLETON_ID = 1


class AppSettings(SQLModel, table=True):
    __tablename__ = "app_settings"

    id: int = Field(default=SINGLETON_ID, primary_key=True)
    data: dict[str, Any] = Field(default_factory=dict, sa_column=jsonb())
    updated_at: datetime = Field(default_factory=utcnow, sa_column=timestamptz())

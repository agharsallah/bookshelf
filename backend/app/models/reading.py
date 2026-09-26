"""HUMAN layer: where you are in each chapter you have opened (see `services/reading.py`)."""

import uuid
from datetime import datetime

from sqlmodel import Field, SQLModel

from app.models._columns import timestamptz, utcnow


class ReadingPosition(SQLModel, table=True):
    __tablename__ = "reading_positions"

    document_id: uuid.UUID = Field(foreign_key="documents.id", ondelete="CASCADE", primary_key=True)
    unit: str = Field(primary_key=True)  # the chapter (or top-level unit) anchor
    anchor: str  # the block last read, where to pick up again
    progress: float  # furthest point reached in the unit, 0 to 1
    updated_at: datetime = Field(default_factory=utcnow, sa_column=timestamptz())

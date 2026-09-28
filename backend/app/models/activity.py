"""HUMAN layer, attention: seconds spent per minute on each surface (see `services/activity.py`)."""

import uuid
from datetime import datetime

from sqlmodel import Field, SQLModel

from app.models._columns import enum_type, timestamptz
from app.models.enums import Surface


class ActivityMinute(SQLModel, table=True):
    __tablename__ = "activity_minutes"

    id: int | None = Field(default=None, primary_key=True)
    minute: datetime = Field(sa_column=timestamptz())  # truncated to the minute
    surface: Surface = Field(sa_type=enum_type(Surface))
    document_id: uuid.UUID | None = Field(
        default=None, foreign_key="documents.id", ondelete="CASCADE"
    )
    unit: str = ""  # the chapter anchor, '' when there is none
    anchor: str = ""  # the block being read, '' when there is none
    detail: str = ""  # what the surface showed: study kind, 'brief', 'episode', ...
    seconds: int

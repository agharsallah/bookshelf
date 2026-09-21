"""Shared dependencies: database session and bounded pagination."""

from typing import Annotated

from fastapi import Depends, Query
from sqlmodel import Session

from app.db.session import get_session

SessionDep = Annotated[Session, Depends(get_session)]

# Hard ceiling on page size: an unbounded `limit` is a denial-of-service knob
# handed to the caller.
MAX_PAGE_SIZE = 100

LimitDep = Annotated[
    int,
    Query(ge=1, le=MAX_PAGE_SIZE, description=f"Page size (max {MAX_PAGE_SIZE})."),
]
OffsetDep = Annotated[int, Query(ge=0, le=100_000, description="Records to skip.")]

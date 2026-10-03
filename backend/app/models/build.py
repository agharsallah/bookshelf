"""Builds (docs/BUILDS.md §3): a paper's ideas turned into a git repository by an agent.

builds       goal, options, stops, plan → state machine (BuildState), commits, events, report
build_plans  every plan a build ever had, append-only (§7b); `builds.plan_version` names
             the current one, `builds.plan` is its copy

The vocabularies live here rather than in `enums.py` (which is near its size budget);
`JobKind.BUILD_PLAN` / `BUILD_RUN` stay with the other job kinds.
"""

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import Column, Numeric
from sqlmodel import Field, SQLModel

from app.models._columns import enum_type, jsonb, timestamptz, utcnow
from app.models.enums import Origin


class BuildState(StrEnum):
    PLANNING = "planning"
    PLANNED = "planned"
    BUILDING = "building"
    STOPPING = "stopping"
    DONE = "done"
    STOPPED = "stopped"
    FAILED = "failed"

    @property
    def is_live(self) -> bool:
        """A job is working on it: the UI polls, and it cannot be deleted."""
        return self in (BuildState.PLANNING, BuildState.BUILDING, BuildState.STOPPING)


class StopReason(StrEnum):
    GOAL_REACHED = "goal_reached"
    MAX_MINUTES = "max_minutes"
    MAX_COMMITS = "max_commits"
    MAX_BUDGET = "max_budget"
    USER = "user"
    AGENT_GAVE_UP = "agent_gave_up"
    ERROR = "error"


class BuildVisibility(StrEnum):
    """Where the repo goes: a GitHub repo (private or public), or nowhere (`local`)."""

    PRIVATE = "private"
    PUBLIC = "public"
    LOCAL = "local"


class Build(SQLModel, table=True):
    __tablename__ = "builds"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    document_id: uuid.UUID = Field(foreign_key="documents.id", ondelete="CASCADE")
    agent: str = "build-from-paper"
    preset: str | None = None
    goal: str
    options: dict[str, Any] = Field(sa_column=jsonb(server_default=None))
    stops: dict[str, Any] = Field(sa_column=jsonb(server_default=None))
    plan: dict[str, Any] | None = Field(
        default=None, sa_column=jsonb(nullable=True, server_default=None)
    )
    plan_origin: Origin | None = Field(default=None, sa_type=enum_type(Origin))
    plan_version: int | None = None  # the build_plans version `plan` is a copy of
    plan_feedback: str | None = None
    state: BuildState = Field(default=BuildState.PLANNING, sa_type=enum_type(BuildState))
    stop_reason: StopReason | None = Field(default=None, sa_type=enum_type(StopReason))
    stop_requested: bool = False
    repo_url: str | None = None
    workspace: str | None = None
    session_id: uuid.UUID | None = None
    commits: list[dict[str, Any]] = Field(
        default_factory=list, sa_column=jsonb(server_default="[]")
    )
    events: list[dict[str, Any]] = Field(default_factory=list, sa_column=jsonb(server_default="[]"))
    report: dict[str, Any] | None = Field(
        default=None, sa_column=jsonb(nullable=True, server_default=None)
    )
    cost_usd: float | None = Field(
        default=None, sa_column=Column(Numeric(10, 4, asdecimal=False), nullable=True)
    )
    error: str | None = None
    plan_job_id: uuid.UUID | None = Field(default=None, foreign_key="jobs.id", ondelete="SET NULL")
    run_job_id: uuid.UUID | None = Field(default=None, foreign_key="jobs.id", ondelete="SET NULL")
    started_at: datetime | None = Field(default=None, sa_column=timestamptz(nullable=True))
    finished_at: datetime | None = Field(default=None, sa_column=timestamptz(nullable=True))
    created_at: datetime = Field(default_factory=utcnow, sa_column=timestamptz())
    updated_at: datetime = Field(default_factory=utcnow, sa_column=timestamptz())


class BuildPlanRecord(SQLModel, table=True):
    """One version of a build's plan (docs/BUILDS.md §7b). Never updated or deleted on its
    own: a restore moves `builds.plan_version`, an edit or replan appends `max + 1`."""

    __tablename__ = "build_plans"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    build_id: uuid.UUID = Field(foreign_key="builds.id", ondelete="CASCADE")
    version: int
    plan: dict[str, Any] = Field(sa_column=jsonb(server_default=None))
    origin: Origin = Field(sa_type=enum_type(Origin))
    feedback: str | None = None  # the replan feedback that produced it
    based_on: int | None = None  # the version it revised; None for a first draft
    model: str | None = None  # a skill draft: the model that ran
    created_at: datetime = Field(default_factory=utcnow, sa_column=timestamptz())

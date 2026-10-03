"""Plan versions (docs/BUILDS.md §7b): every plan a build ever had, append-only.

    record_plan    a planner draft (first or replan) or your edit → version max + 1, current
    restore_plan   point `builds.plan_version` at an older version; no new row (B16)
    list_plan_versions, current_version, versions_count, versions_counts   the reads

`builds.plan` stays a copy of the current version, so everything that reads the plan (the
runner, the seed, the context view, approve) keeps reading the build alone.
"""

import uuid
from collections.abc import Iterable, Mapping
from typing import Any

from sqlmodel import Session, col, func, select

from app.core.errors import ConflictError, NotFoundError
from app.models import Build, BuildPlanRecord
from app.models.build import BuildState
from app.models.enums import Origin


def _next_version(session: Session, build_id: uuid.UUID) -> int:
    latest = session.exec(
        select(func.max(BuildPlanRecord.version)).where(BuildPlanRecord.build_id == build_id)
    ).one()
    return int(latest or 0) + 1


def record_plan(
    session: Session,
    build: Build,
    plan: Mapping[str, Any],
    *,
    origin: Origin,
    feedback: str | None = None,
    based_on: int | None = None,
    model: str | None = None,
) -> BuildPlanRecord:
    """Append `plan` as version max + 1 and make it the build's current plan. Adds both rows
    to the session; the caller commits (with its own state change, in one transaction)."""
    record = BuildPlanRecord(
        build_id=build.id,
        version=_next_version(session, build.id),
        plan=dict(plan),
        origin=origin,
        feedback=feedback,
        based_on=based_on,
        model=model,
    )
    build.plan, build.plan_origin, build.plan_version = record.plan, origin, record.version
    session.add(record)
    session.add(build)
    return record


def list_plan_versions(session: Session, build: Build) -> list[BuildPlanRecord]:
    """Every version of the build's plan, newest first."""
    return list(
        session.exec(
            select(BuildPlanRecord)
            .where(BuildPlanRecord.build_id == build.id)
            .order_by(col(BuildPlanRecord.version).desc())
        )
    )


def get_plan_version(session: Session, build: Build, version: int) -> BuildPlanRecord | None:
    return session.exec(
        select(BuildPlanRecord).where(
            BuildPlanRecord.build_id == build.id, BuildPlanRecord.version == version
        )
    ).first()


def current_version(session: Session, build: Build) -> BuildPlanRecord | None:
    """The version `builds.plan` is a copy of; None before the first plan."""
    if build.plan_version is None:
        return None
    return get_plan_version(session, build, build.plan_version)


def restore_plan(session: Session, build: Build, version: int) -> Build:
    """Make `version` current again, only while the build is `planned`. It moves the
    pointer: the next edit or replan appends max + 1 based on it."""
    if build.state is not BuildState.PLANNED:
        raise ConflictError(
            f"Cannot restore a plan of a build that is {build.state.value} (only when planned)."
        )
    record = get_plan_version(session, build, version)
    if record is None:
        raise NotFoundError(f"Build {build.id} has no plan version {version}.")
    build.plan, build.plan_origin, build.plan_version = record.plan, record.origin, version
    session.add(build)
    session.commit()
    session.refresh(build)
    return build


def versions_counts(session: Session, build_ids: Iterable[uuid.UUID]) -> dict[uuid.UUID, int]:
    """How many plan versions each build has, in one grouped query (absent: 0)."""
    ids = list(build_ids)
    if not ids:
        return {}
    rows = session.exec(
        select(BuildPlanRecord.build_id, func.count())
        .where(col(BuildPlanRecord.build_id).in_(ids))
        .group_by(col(BuildPlanRecord.build_id))
    ).all()
    return {build_id: int(count) for build_id, count in rows}


def versions_count(session: Session, build: Build) -> int:
    return versions_counts(session, [build.id]).get(build.id, 0)

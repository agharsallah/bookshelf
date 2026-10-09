"""When `make-pills` runs (docs/PILLS.md §5): lazily, per chapter, within a daily budget.

Nothing is composed when a book is added. Three entry points, all queueing `derive` jobs of
make-pills, one per chapter (`anchor`), keyed `skill:make-pills:<style>` so the queue
dedupes a chapter already waiting; the run itself is skipped when an artifact for its exact
`input_hash` exists (`pipeline.execution`):

* `top_up(session, document_ids, unseen)`: a feed session whose unseen supply dropped under
  `LOW_WATER`, with `app_settings.pills.auto_generate` on, queues up to
  `MAX_CHAPTERS_PER_TOP_UP` chapters of the feed's documents (its resolved scope,
  `feed.scope.resolve`) that have a chapter distillation and no
  `pill_set`: the chapters in progress, then the next unread one, then the rest in reading
  order. Never more than `pills.max_chapters_per_day` make-pills jobs a day (every one
  queued today counts), and a chapter tried today is not tried again until tomorrow.
* `enqueue(session, document, anchors, style)`: `POST /pills/generate`, an explicit
  request: the chapters named (each must be distilled), else every generatable chapter of
  the document. Not capped: a person asked.
* `estimate_tokens(session, skill, chapters)`: what that many runs are expected to cost,
  from `model_runs` (the skill's average per job, else the average of the other
  explore-tier derive skills); None without history.
"""

import uuid
from collections.abc import Iterable, Sequence
from typing import Any

from sqlalchemy import func
from sqlmodel import Session, col, select

from app.core.config import get_settings
from app.jobs.queue import JobSpec
from app.models import Job, ModelRun
from app.models.enums import ArtifactType, JobKind, Tier
from app.pills.generatable import (
    Candidate,
    anchors_with,
    candidates,
    generatable,
    today,
)
from app.pills.harvest.pill_set import SKILL
from app.pipeline.skills import ParamError, Skill, load_catalogue
from app.services import app_settings
from app.services.documents import get_document
from app.services.errors import InvalidInputError

__all__ = [
    "LOW_WATER",
    "SKILL",
    "Candidate",
    "enqueue",
    "estimate_tokens",
    "generatable",
    "top_up",
]

LOW_WATER = 30
MAX_CHAPTERS_PER_TOP_UP = 2
PILLS_PRIORITY = 110  # after the pipeline's own stages, before study-material derives (115)

# --- Queueing -----------------------------------------------------------------------------


def _skill() -> Skill | None:
    return load_catalogue(get_settings().skills_dir).get(SKILL)


def _spec(skill: Skill, document_id: uuid.UUID, anchor: str, style: str | None) -> JobSpec:
    """A make-pills job keyed like the same run started by hand (`services.jobs.job_spec`),
    so the queue dedupes the two. `ParamError` for a style the skill does not offer."""
    params = skill.meta.resolve_params({"style": style} if style else None)
    return JobSpec(
        kind=JobKind.DERIVE,
        document_id=document_id,
        anchor=anchor,
        skill=skill.name,
        input_hash=f"skill:{skill.name}:{skill.meta.variant_of(params)}",
        payload={"params": dict(params)},
        priority=PILLS_PRIORITY,
    )


def _queue(session: Session, specs: Iterable[JobSpec]) -> list[uuid.UUID]:
    from app.services.jobs import enqueue_or_live  # lazy: services import the pipeline

    return [enqueue_or_live(session, spec)[0].id for spec in specs]


def queued_today(session: Session) -> int:
    """make-pills jobs created since midnight (UTC), whatever became of them."""
    count = session.exec(
        select(func.count())
        .select_from(Job)
        .where(Job.kind == JobKind.DERIVE, Job.skill == SKILL, col(Job.created_at) >= today())
    ).one()
    return int(count)


def top_up(session: Session, document_ids: Sequence[uuid.UUID], unseen: int) -> list[uuid.UUID]:
    """Queue make-pills for a feed running low over `document_ids` (its resolved scope);
    returns the queued job ids (none when the supply is fine, auto-generation is off, the
    day's budget is spent or nothing is open)."""
    if unseen >= LOW_WATER:
        return []
    settings = app_settings.pills_settings(session)
    if not settings.auto_generate:
        return []
    budget = min(MAX_CHAPTERS_PER_TOP_UP, settings.max_chapters_per_day - queued_today(session))
    skill = _skill()
    if budget <= 0 or skill is None:
        return []
    chosen = candidates(session, document_ids)[:budget]
    return _queue(session, (_spec(skill, c.document_id, c.anchor, None) for c in chosen))


def enqueue(
    session: Session,
    document_ref: str | uuid.UUID,
    anchors: list[str] | None,
    style: str | None,
) -> tuple[list[uuid.UUID], int | None]:
    """`POST /pills/generate`: queue make-pills for `anchors` (each must have a chapter
    distillation), else for every generatable chapter of the document. Returns the job ids
    (a chapter already waiting keeps its job) and the token estimate for them.

    `NotFoundError` for an unknown document; `InvalidInputError` for an undistilled anchor,
    an unknown style, or a shelf without the make-pills skill."""
    document = get_document(session, str(document_ref))
    skill = _skill()
    if skill is None:
        raise InvalidInputError(f"The {SKILL} skill is not installed.", field="body")
    if anchors is None:
        chosen = generatable(session, document.id)
    else:
        distilled = anchors_with(session, [document.id], ArtifactType.CHAPTER_DISTILLATION)[
            document.id
        ]
        missing = [a for a in anchors if a not in distilled]
        if missing:
            raise InvalidInputError(
                f"No chapter distillation yet for {', '.join(missing)}.", field="body.anchors"
            )
        chosen = list(dict.fromkeys(anchors))
    try:
        specs = [_spec(skill, document.id, anchor, style) for anchor in chosen]
    except ParamError as exc:
        raise InvalidInputError(str(exc), field="body.style") from exc
    ids = _queue(session, specs)
    return ids, estimate_tokens(session, SKILL, len(ids))


# --- Estimates ----------------------------------------------------------------------------


def _average_job_tokens(session: Session, *conditions: Any) -> float | None:
    """Mean tokens per job (every call of a job summed: retries cost too) over the runs
    matching `conditions`; None without any."""
    per_job = (
        select(
            func.sum(
                func.coalesce(ModelRun.input_tokens, 0)
                + func.coalesce(ModelRun.output_tokens, 0)
                + func.coalesce(ModelRun.cache_read_tokens, 0)
                + func.coalesce(ModelRun.cache_write_tokens, 0)
            ).label("tokens")
        )
        .where(col(ModelRun.job_id).is_not(None), *conditions)
        .group_by(col(ModelRun.job_id))
        .subquery()
    )
    average = session.exec(select(func.avg(per_job.c.tokens))).one()
    return float(average) if average is not None else None


def estimate_tokens(session: Session, skill: str, chapters: int) -> int | None:
    """Tokens `chapters` runs of `skill` are expected to cost: its average per job, else
    the average of the other explore-tier `derive` skills; None without history."""
    average = _average_job_tokens(session, ModelRun.skill == skill)
    if average is None:
        average = _average_job_tokens(
            session,
            ModelRun.kind == JobKind.DERIVE,
            ModelRun.tier == Tier.EXPLORE,
            ModelRun.skill != skill,
        )
    if average is None:
        return None
    return round(average * max(chapters, 0))

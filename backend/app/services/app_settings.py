"""Server-side settings: one row, holding only the choices that were made.

Today that is `auto_derive`: the study-material skills a document queues on its own once
it is distilled (its brief, or a paper's card, approved), one list per group, `book` and
`paper`. A group never set has no entry; the caller supplies its default (the paper
profile's own by-products), so a new install behaves as before.

And `queue`: whether the job queue is paused and how many jobs may run at once, read by
`jobs.queue.claim` in SQL so every worker obeys a change on its next claim.

And `auto_approve`: whether a skill's fresh artifact is approved on arrival instead of
waiting for a review (`pipeline.auto_approval`): `off`, `passing` (only drafts that passed
every soft gate) or `all` (`needs_review` too).
"""

from collections.abc import Mapping
from dataclasses import dataclass, replace
from typing import Any, Literal, get_args

from sqlmodel import Session

from app.jobs.queue import JobSpec
from app.models import AppSettings
from app.models._columns import utcnow
from app.models.app_settings import SINGLETON_ID
from app.models.enums import Genre, JobKind, Review
from app.pipeline.skills import Skill
from app.services.errors import InvalidInputError

GROUPS = ("book", "paper")
# The book guide is a fixed stage of every book's pipeline, not a choice.
_FIXED = frozenset({"write-guide"})
DERIVE_PRIORITY = 115  # after the brief and the guide (105), before narration (130)


def group_of(genre: Genre) -> str:
    return "paper" if genre is Genre.PAPER else "book"


def eligible(catalogue: Mapping[str, Skill], group: str) -> dict[str, Skill]:
    """The skills a document of `group` can make on its own: queued `derive` skills that run
    on a whole document and speak nothing (a narration needs a cast chosen per run). A paper
    skill is for papers only; the genre-neutral ones (quiz, FAQ, glossary…) suit both."""
    wanted = Genre.PAPER if group == "paper" else None
    return {
        name: skill
        for name, skill in catalogue.items()
        if skill.meta.job_kind is JobKind.DERIVE
        and name not in _FIXED
        and not skill.meta.narrate
        and (skill.meta.scope == "document" or skill.meta.document_selector is not None)
        and skill.meta.genre in ({wanted, None} if wanted else {None})
    }


def derive_spec(skill: Skill, document_id: object) -> JobSpec:
    """A whole-document `derive` job, keyed like the same run started by hand
    (`services.jobs.job_spec`) so the queue dedupes the two."""
    params = skill.meta.resolve_params(None)
    variant = skill.meta.variant_of(params) if params else None
    return JobSpec(
        kind=JobKind.DERIVE,
        document_id=document_id,  # type: ignore[arg-type]
        skill=skill.name,
        input_hash=f"skill:{skill.name}" + (f":{variant}" if variant else ""),
        payload={"params": dict(params)} if params else None,
        priority=DERIVE_PRIORITY,
    )


def stored_auto_derive(session: Session) -> dict[str, list[str]]:
    """The groups whose list was set, each as stored."""
    row = session.get(AppSettings, SINGLETON_ID)
    stored = (row.data if row else {}).get("auto_derive")
    if not isinstance(stored, dict):
        return {}
    return {
        group: [str(name) for name in names]
        for group, names in stored.items()
        if group in GROUPS and isinstance(names, list)
    }


def set_auto_derive(
    session: Session, lists: Mapping[str, list[str]], catalogue: Mapping[str, Skill]
) -> None:
    """Replace the lists of the groups given; a group left out keeps what it had.
    `InvalidInputError` for a skill the group cannot run on its own."""
    merged = stored_auto_derive(session)
    for group, names in lists.items():
        allowed = eligible(catalogue, group)
        for name in names:
            if name not in allowed:
                raise InvalidInputError(
                    f"{name!r} cannot run on its own for a {group}.", field=f"body.{group}"
                )
        merged[group] = list(dict.fromkeys(names))
    _save(session, "auto_derive", merged)


def _save(session: Session, key: str, value: Any) -> None:
    """Replace one setting, leaving the others as stored."""
    row = session.get(AppSettings, SINGLETON_ID) or AppSettings()
    row.data = {**row.data, key: value}
    row.updated_at = utcnow()
    session.add(row)
    session.commit()


@dataclass(frozen=True, slots=True)
class QueueControls:
    """`paused`: claim nothing (running jobs finish). `max_running`: jobs running at once
    across every worker (`None`: as many as the workers have slots). `paused_reason`: why
    the queue paused itself (a usage limit), `None` when a person paused it; a resume
    clears it."""

    paused: bool = False
    max_running: int | None = None
    paused_reason: str | None = None


def queue_controls(session: Session) -> QueueControls:
    row = session.get(AppSettings, SINGLETON_ID)
    stored = (row.data if row else {}).get("queue")
    if not isinstance(stored, dict):
        return QueueControls()
    cap = stored.get("max_running")
    paused = stored.get("paused") is True
    reason = stored.get("paused_reason")
    return QueueControls(
        paused=paused,
        max_running=cap if isinstance(cap, int) and cap > 0 else None,
        paused_reason=reason if paused and isinstance(reason, str) else None,
    )


def set_queue_controls(session: Session, controls: QueueControls) -> QueueControls:
    reason = controls.paused_reason if controls.paused else None
    _save(session, "queue", {"paused": controls.paused, "max_running": controls.max_running,
                             "paused_reason": reason})  # fmt: skip
    return controls


def pause_queue(session: Session, reason: str) -> None:
    """Pause every worker, saying why; the cap is kept. A resume (`paused: false`) lifts it."""
    current = queue_controls(session)
    set_queue_controls(session, replace(current, paused=True, paused_reason=reason))


AutoApprove = Literal["off", "passing", "all"]
AUTO_APPROVE_MODES: tuple[AutoApprove, ...] = get_args(AutoApprove)
# What each mode approves on arrival; anything else waits for a person.
_APPROVES: dict[str, frozenset[Review]] = {
    "off": frozenset(),
    "passing": frozenset({Review.DRAFT}),
    "all": frozenset({Review.DRAFT, Review.NEEDS_REVIEW}),
}


def auto_approve(session: Session) -> AutoApprove:
    row = session.get(AppSettings, SINGLETON_ID)
    stored = (row.data if row else {}).get("auto_approve")
    return stored if stored in AUTO_APPROVE_MODES else "off"


def set_auto_approve(session: Session, mode: AutoApprove) -> None:
    _save(session, "auto_approve", mode)


def approves(mode: AutoApprove, review: Review) -> bool:
    """Whether `mode` approves an artifact the gates stored as `review`."""
    return review in _APPROVES[mode]

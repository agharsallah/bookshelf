"""`paper_watch`: new works citing the papers you rated >= 4 (docs/PAPERS.md §5 "Watch list").

    latest rating >= 4 ─► OpenAlex `cites:W…, from_publication_date: <last check>`
        ─► reading_candidates with a `watch` source ─► queue `paper_candidates` to rescore

The last check per paper is the job history: each run records `result.checked =
{document_id: "YYYY-MM-DD"}`, and the next run asks only for works published since. A paper
checked less than `STALE_DAYS` ago is skipped unless the job's payload has `force: true`;
a paper never checked looks back `FIRST_LOOKBACK_DAYS`. No extra table or column.
"""

import logging
import uuid
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlmodel import Session, col, select

from app.db.session import release
from app.jobs.queue import JobSpec
from app.models import Job
from app.models.enums import JobKind, JobState
from app.papers import candidate_store
from app.papers.openalex import OpenAlex
from app.papers.shelf import latest_ratings, load_shelf, watched
from app.papers.works import Work
from app.services.jobs import enqueue_or_live

logger = logging.getLogger(__name__)

STALE_DAYS = 7
FIRST_LOOKBACK_DAYS = 365
CITING_LIMIT = 50
_HISTORY = 50  # past watch runs read to find each paper's last check


@dataclass(frozen=True, slots=True)
class WatchOutcome:
    checked: dict[str, str] = field(default_factory=dict)  # document_id → date checked
    skipped: list[str] = field(default_factory=list)  # checked recently, or no OpenAlex id
    found: int = 0
    new: int = 0

    def as_result(self) -> dict[str, Any]:
        return {
            "checked": self.checked,
            "skipped": self.skipped,
            "found": self.found,
            "new": self.new,
        }


def watch_spec(*, force: bool = False) -> JobSpec:
    return JobSpec(kind=JobKind.PAPER_WATCH, payload={"force": force}, input_hash=f"force={force}")


def last_checks(session: Session) -> dict[uuid.UUID, date]:
    """The latest check date per watched paper, from finished `paper_watch` jobs."""
    jobs = session.exec(
        select(Job)
        .where(Job.kind == JobKind.PAPER_WATCH, Job.state == JobState.DONE)
        .order_by(col(Job.finished_at).desc())
        .limit(_HISTORY)
    )
    latest: dict[uuid.UUID, date] = {}
    for job in jobs:
        for document_id, checked in ((job.result or {}).get("checked") or {}).items():
            try:
                key, when = uuid.UUID(document_id), date.fromisoformat(checked)
            except (TypeError, ValueError):
                continue
            if key not in latest or when > latest[key]:
                latest[key] = when
    return latest


def run_watch(
    session: Session, api: OpenAlex, *, force: bool = False, today: date | None = None
) -> WatchOutcome:
    """Ask OpenAlex for new citers of every watched paper; write candidates; commits."""
    today = today or datetime.now(UTC).date()
    ratings = latest_ratings(session)
    shelf = load_shelf(session)
    checks = last_checks(session)
    release(session)

    plan: list[tuple[uuid.UUID, str, date]] = []
    skipped: list[str] = []
    for document_id in watched(ratings):
        paper = shelf.by_id(document_id)
        last = checks.get(document_id)
        recent = last is not None and (today - last).days < STALE_DAYS
        if paper is None or not paper.openalex_id or (recent and not force):
            skipped.append(str(document_id))
            continue
        since = last or today - timedelta(days=FIRST_LOOKBACK_DAYS)
        plan.append((document_id, paper.openalex_id, since))

    found: list[tuple[uuid.UUID, Work]] = []
    for document_id, openalex_id, since in plan:
        found.extend(
            (document_id, w) for w in api.citing(openalex_id, since=since, limit=CITING_LIMIT)
        )

    _, index = candidate_store.load_index(session)
    new = 0
    for document_id, work in found:
        on_shelf = shelf.match(
            openalex_id=work.openalex_id, doi=work.doi, arxiv_id=work.arxiv_id,
            title=work.title, year=work.year,
        )  # fmt: skip
        if on_shelf is None:
            new += candidate_store.merge_watch(
                session, index, work, document_id, ratings=ratings, current_year=today.year
            )
    session.commit()
    if found:
        enqueue_or_live(session, JobSpec(kind=JobKind.PAPER_CANDIDATES))
    outcome = WatchOutcome(
        checked={str(d): today.isoformat() for d, _, _ in plan},
        skipped=skipped,
        found=len(found),
        new=new,
    )
    logger.info("Watch list checked", extra={"found": outcome.found, "new": outcome.new})
    return outcome

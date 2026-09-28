"""`paper_watch`: citers of your >= 4-star papers since each one's last check, recorded in
the job history; recent checks are skipped unless forced."""

from datetime import date, timedelta

from sqlmodel import Session, select

from app.models import Job, ReadingCandidate
from app.models.enums import JobKind, JobState
from app.papers import watch
from app.papers.http import http_client
from app.papers.http import openalex as make_api
from app.pipeline.handlers.paper_external import run_paper_watch
from tests.papers.conftest import done_watch_job, job_context, make_paper
from tests.papers.fake_openalex import FakeOpenAlex

TODAY = date(2026, 9, 28)


def run(session: Session, *, force: bool = False) -> watch.WatchOutcome:
    with http_client() as client:
        return watch.run_watch(session, make_api(client), force=force, today=TODAY)


def since_asked(openalex: FakeOpenAlex) -> list[str]:
    filters = [r.url.params.get("filter", "") for r in openalex.requests]
    return [f for f in filters if f.startswith("cites:")]


def test_new_citers_of_watched_papers_become_watch_candidates(
    session: Session, openalex: FakeOpenAlex
):
    liked = make_paper(session, "Liked", stars=4, meta={"openalex_id": "W100"})
    make_paper(session, "Meh", stars=3, meta={"openalex_id": "W200"})
    make_paper(session, "Own citer on shelf", meta={"openalex_id": "W5"})
    openalex.add("W4", "A new citer", publication_date="2026-06-01")
    openalex.add("W5", "Own citer on shelf", publication_date="2026-07-01")
    openalex.citing["W100"] = ["W4", "W5"]
    openalex.citing["W200"] = ["W4"]

    outcome = run(session)

    assert outcome.checked == {str(liked.id): "2026-09-28"}
    assert (outcome.found, outcome.new) == (2, 1)
    assert since_asked(openalex) == [
        f"cites:W100,from_publication_date:{(TODAY - timedelta(days=365)).isoformat()}"
    ]
    (row,) = session.exec(select(ReadingCandidate)).all()
    assert row.openalex_id == "W4"
    assert row.sources == [{"kind": "watch", "document_id": str(liked.id)}]
    assert row.score > 0 and row.score_parts["source"] > 0
    rescore = session.exec(select(Job).where(Job.kind == JobKind.PAPER_CANDIDATES)).all()
    assert len(rescore) == 1  # the rebuild scores it with everything else


def test_the_next_run_asks_only_since_the_last_check_and_skips_recent_ones(
    session: Session, openalex: FakeOpenAlex
):
    liked = make_paper(session, "Liked", stars=5, meta={"openalex_id": "W100"})
    done_watch_job(session, {str(liked.id): (TODAY - timedelta(days=3)).isoformat()})

    skipped = run(session)
    assert skipped.skipped == [str(liked.id)] and skipped.checked == {}
    assert since_asked(openalex) == []

    forced = run(session, force=True)
    assert forced.checked == {str(liked.id): TODAY.isoformat()}
    assert since_asked(openalex) == ["cites:W100,from_publication_date:2026-09-25"]


def test_an_existing_candidate_gains_the_watch_source_once_without_changing_status(
    session: Session, openalex: FakeOpenAlex
):
    liked = make_paper(session, "Liked", stars=4, meta={"openalex_id": "W100"})
    openalex.add("W4", "A new citer", publication_date="2026-06-01")
    openalex.citing["W100"] = ["W4"]
    existing = ReadingCandidate(title="A new citer", openalex_id="W4", status="dismissed")
    session.add(existing)
    session.commit()

    assert run(session).new == 0
    assert run(session, force=True).new == 0
    session.refresh(existing)
    assert existing.status == "dismissed"
    assert existing.sources == [{"kind": "watch", "document_id": str(liked.id)}]


def test_the_handler_records_checks_for_the_next_run(session: Session, openalex: FakeOpenAlex):
    liked = make_paper(session, "Liked", stars=4, meta={"openalex_id": "W100"})
    ctx = job_context(session, watch.watch_spec())
    result = run_paper_watch(ctx).result
    ctx.job.state, ctx.job.result = JobState.DONE, result
    session.add(ctx.job)
    session.commit()
    assert set(watch.last_checks(session)) == {liked.id}

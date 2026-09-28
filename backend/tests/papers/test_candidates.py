"""`paper_candidates`: every path to a candidate, shelf exclusion, scoring, and the upsert
rules (status is yours: dismissed is never resurrected)."""

import pytest
from sqlmodel import Session, select

from app.jobs.queue import JobSpec
from app.models import Job, PaperReference, ReadingCandidate
from app.models.enums import CandidateSource, CandidateStatus, CitationIntent, JobKind
from app.papers import candidate_store
from app.papers.scoring import PARTS
from app.pipeline.handlers import paper_shelf  # noqa: F401  (registers recommend_next)
from app.pipeline.handlers.paper_external import run_paper_candidates
from tests.papers.conftest import job_context, make_paper
from tests.papers.fake_openalex import FakeOpenAlex

ABSTRACT = "sparse mixture of experts routing scales language models"


def rebuild(session: Session) -> dict:
    return run_paper_candidates(job_context(session, JobSpec(kind=JobKind.PAPER_CANDIDATES))).result


def rows(session: Session) -> dict[str, ReadingCandidate]:
    return {r.openalex_id or r.title: r for r in session.exec(select(ReadingCandidate))}


def kinds(row: ReadingCandidate) -> set[str]:
    return {s["kind"] for s in row.sources}


def shelf(session: Session, openalex: FakeOpenAlex):
    openalex.add("W100", "Mixture of Experts", referenced_works=["W1", "W2"], related_works=["W3"])
    openalex.add("W1", "Adam", cited_by_count=5000, year=2014)
    openalex.add("W2", "Already On My Shelf", year=2019)
    openalex.add("W3", "Related Work", abstract=ABSTRACT, year=2024)
    openalex.add("W4", "A Paper Citing Mine", year=2025)
    openalex.citing["W100"] = ["W4"]
    liked = make_paper(
        session, "Mixture of Experts", stars=5, meta={"openalex_id": "W100", "abstract": ABSTRACT}
    )
    make_paper(session, "Already on my shelf", stars=2, meta={"openalex_id": "W2"})
    return liked


def test_rebuild_gathers_references_citers_related_and_similar_and_skips_the_shelf(
    session: Session, openalex: FakeOpenAlex
):
    liked = shelf(session, openalex)
    session.add(
        PaperReference(
            document_id=liked.id, ordinal=1, raw="[1] Kingma & Ba", title="Adam",
            openalex_id="W1", intent=CitationIntent.USES,
        )
    )  # fmt: skip
    session.add(
        PaperReference(document_id=liked.id, ordinal=2, raw="[2] x", title="Unindexed Book")
    )
    session.commit()

    result = rebuild(session)

    found = rows(session)
    assert set(found) == {"W1", "W3", "W4", "Unindexed Book"}  # W2 and W100 are on the shelf
    assert kinds(found["W1"]) == {CandidateSource.REFERENCE}
    assert kinds(found["W4"]) == {CandidateSource.CITED_BY}
    assert kinds(found["W3"]) == {CandidateSource.RELATED, CandidateSource.SIMILAR}
    assert all(s["document_id"] == str(liked.id) for r in found.values() for s in r.sources)
    adam = found["W1"]
    assert set(adam.score_parts) == set(PARTS)
    assert adam.score_parts["intent"] > 0 and adam.score_parts["rating"] > 0
    assert adam.score == pytest.approx(sum(adam.score_parts.values()), abs=1e-5)
    assert adam.cited_by_count == 5000 and adam.status == CandidateStatus.SUGGESTED
    assert found["W3"].score_parts["similarity"] > 0.75
    assert result["created"] == 4


def test_rebuild_keeps_your_status_and_drops_stale_suggestions(
    session: Session, openalex: FakeOpenAlex
):
    shelf(session, openalex)
    dismissed = ReadingCandidate(
        title="Related Work", openalex_id="W3", status=CandidateStatus.DISMISSED
    )
    queued = ReadingCandidate(title="Adam", openalex_id="W1", status=CandidateStatus.QUEUED)
    stale = ReadingCandidate(title="Gone", openalex_id="W999")
    stale_queued = ReadingCandidate(title="Kept", openalex_id="W998", status=CandidateStatus.QUEUED)
    watched = ReadingCandidate(
        title="Watched", openalex_id="W997", sources=[{"kind": "watch", "document_id": None}]
    )
    session.add_all([dismissed, queued, stale, stale_queued, watched])
    session.commit()

    result = rebuild(session)

    found = rows(session)
    assert found["W3"].status == CandidateStatus.DISMISSED and found["W3"].score > 0
    assert found["W1"].status == CandidateStatus.QUEUED
    assert "W999" not in found and result["removed"] == 1
    assert "W998" in found and "W997" in found
    assert kinds(found["W997"]) == {CandidateSource.WATCH}
    assert result["updated"] == 3  # W1, W3 and the watched one


def test_without_a_recommend_next_handler_the_rebuild_queues_nothing(
    session: Session, openalex: FakeOpenAlex, monkeypatch: pytest.MonkeyPatch
):
    shelf(session, openalex)
    monkeypatch.setattr(candidate_store, "get_handler", lambda kind: None)
    assert rebuild(session)["recommend_next_job"] is None


def test_the_top_candidates_go_to_recommend_next(session: Session, openalex: FakeOpenAlex):
    shelf(session, openalex)
    result = rebuild(session)
    job = session.get(Job, result["recommend_next_job"])
    assert job is not None and job.kind == JobKind.RECOMMEND_NEXT
    assert job.payload["candidate_ids"] == result["top"]
    best = session.get(ReadingCandidate, result["top"][0])
    assert best is not None
    assert best.score == max(r.score for r in rows(session).values())

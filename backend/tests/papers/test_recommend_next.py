"""`recommend_next`: the model explains the top candidates from the shelf passages that lead
to them; it never touches scores, order or status (P6)."""

import json
import uuid

import pytest
from sqlmodel import Session

from app.core.config import get_settings
from app.jobs.registry import PermanentJobError, get_handler
from app.models import Document, Job, PaperReference, ReadingCandidate
from app.models.enums import ArtifactType, CitationIntent, JobKind, NodeKind
from app.papers import candidate_store, recommend
from app.papers.selectors.shelf import citing_sentence, recommend_input
from app.pipeline.handlers import paper_shelf  # registers the handlers
from app.pipeline.runner import FakeRunner
from app.pipeline.skills import Skill, load_skill
from tests.api.factories import make_artifact, make_node
from tests.papers.conftest import make_paper

CITING = "Earlier work gates experts [3]. We route tokens with the gate of [7], unchanged."


@pytest.fixture
def skill() -> Skill:
    return load_skill(get_settings().skills_dir / recommend.SKILL_NAME)


def cited_paper(session: Session) -> tuple[Document, ReadingCandidate, ReadingCandidate]:
    """A 5-star paper citing candidate `gate` (reference [7]); `other` comes from another
    path and has no passages of its own."""
    paper = make_paper(session, "Mixture of Experts", stars=5)
    chapter = make_node(session, paper, "ch03", NodeKind.CHAPTER)
    make_node(session, paper, "ch03/p002", NodeKind.PARAGRAPH, parent=chapter, text=CITING)
    make_node(session, paper, "ch01/p001", NodeKind.PARAGRAPH, text="A router for experts.")
    make_artifact(
        session,
        paper,
        type=ArtifactType.PAPER_CARD,
        body={"tldr": [{"text": "Sparse experts scale.", "cites": ["ch01/p001"]}]},
    )
    session.add(
        PaperReference(
            document_id=paper.id, ordinal=7, raw="[7] Gating networks", title="Gating Networks",
            openalex_id="W7", cited_at=["ch03/p002"], intent=CitationIntent.USES,
        )
    )  # fmt: skip
    source = [{"kind": "reference", "document_id": str(paper.id)}]
    gate = ReadingCandidate(
        title="Gating Networks", openalex_id="W7", sources=source, score=2.5,
        score_parts={"rating": 1.0, "intent": 1.5},
    )  # fmt: skip
    other = ReadingCandidate(title="Loose", openalex_id="W8", score=1.0, sources=[])
    session.add_all([gate, other])
    session.commit()
    return paper, gate, other


def reply(*reasons: tuple[ReadingCandidate, str, list[str]]) -> str:
    return json.dumps(
        {"reasons": [{"candidate_id": str(c.id), "reason": r, "cites": k} for c, r, k in reasons]}
    )


def test_the_input_carries_the_citing_sentence_rating_and_tldr(session: Session):
    paper, gate, _ = cited_paper(session)

    given = recommend_input(session, [gate.id])

    (candidate,) = given.inputs["candidates"]
    (lead,) = candidate["leads"]
    assert lead["rating"] == {"stars": 5, "verdict": None} and lead["intents"] == ["uses"]
    assert [p["kind"] for p in lead["passages"]] == ["citing_sentence", "tldr"]
    assert lead["passages"][0]["text"] == "We route tokens with the gate of [7], unchanged."
    assert given.allowed[str(gate.id)] == {f"{paper.id}#ch03/p002", f"{paper.id}#ch01/p001"}
    assert candidate["score_parts"] == {"intent": 1.5, "rating": 1.0}


def test_citing_sentence_finds_ranges_and_lists_and_falls_back_to_the_text():
    assert citing_sentence("A [1]. B uses [2, 7]. C.", 7) == "B uses [2, 7]."
    assert citing_sentence("Nothing marked here.", 4) == "Nothing marked here."


def test_reasons_are_written_and_scores_left_alone(session: Session, skill: Skill):
    paper, gate, other = cited_paper(session)
    before = [(c.score, dict(c.score_parts), c.status) for c in (gate, other)]
    runner = FakeRunner(
        reply(
            (gate, "You rated Mixture of Experts 5 stars; it routes with this gate.",
             [f"{paper.id}#ch03/p002"]),
            (other, "Widely read; nothing on your shelf leads to it yet.", []),
        )
    )  # fmt: skip

    written, _ = recommend.recommend(session, [gate.id, other.id], runner=runner, skill=skill)

    assert written == 2 and len(runner.calls) == 1
    for row, (score, parts, status) in zip((gate, other), before, strict=True):
        session.refresh(row)
        assert (row.score, row.score_parts, row.status) == (score, parts, status)
    assert gate.reason is not None and gate.reason.startswith("You rated")
    assert gate.reason_cites == [f"{paper.id}#ch03/p002"]
    assert other.reason_cites == []


def test_a_cite_from_a_paper_that_does_not_lead_there_is_refused(session: Session, skill: Skill):
    _, gate, _ = cited_paper(session)
    stranger = make_paper(session, "Unrelated")
    make_node(session, stranger, "ch01/p001", NodeKind.PARAGRAPH)
    foreign = reply((gate, "Because.", [f"{stranger.id}#ch01/p001"]))
    runner = FakeRunner(foreign, foreign)

    with pytest.raises(PermanentJobError):
        recommend.recommend(session, [gate.id], runner=runner, skill=skill)

    assert len(runner.calls) == 2  # asked again with the problem, then gave up
    assert "not among its leads" in runner.calls[1]["prompt"]
    session.refresh(gate)
    assert gate.reason is None


def test_every_candidate_needs_one_reason_and_its_passages_cited(session: Session, skill: Skill):
    paper, gate, other = cited_paper(session)
    good = reply((gate, "It is the gate you use.", [f"{paper.id}#ch01/p001"]), (other, "x", []))
    runner = FakeRunner(reply((gate, "Uncited.", [])), good)

    recommend.recommend(session, [gate.id, other.id], runner=runner, skill=skill)

    assert "one reason per candidate" in runner.calls[1]["prompt"]
    session.refresh(gate)
    assert gate.reason_cites == [f"{paper.id}#ch01/p001"]


def test_the_job_reads_its_payload(session: Session):
    paper, gate, _ = cited_paper(session)
    job = Job(kind=JobKind.RECOMMEND_NEXT, payload={"candidate_ids": [str(gate.id)]})
    runner = FakeRunner(reply((gate, "Read it.", [f"{paper.id}#ch03/p002"])))

    result = recommend.run_recommend_job(session, job, runner=runner)

    assert result.result == {"candidates": 1, "explained": 1}
    bad = Job(kind=JobKind.RECOMMEND_NEXT, payload={"candidate_ids": ["nope"]})
    with pytest.raises(PermanentJobError):
        recommend.run_recommend_job(session, bad, runner=runner)
    gone = Job(kind=JobKind.RECOMMEND_NEXT, payload={"candidate_ids": [str(uuid.uuid4())]})
    assert recommend.run_recommend_job(session, gone, runner=runner).result["explained"] == 0


def test_the_rebuild_hook_queues_recommend_next_now_that_it_has_a_handler(session: Session):
    assert get_handler(JobKind.RECOMMEND_NEXT) is paper_shelf.run_recommend_next
    _, gate, other = cited_paper(session)

    job = candidate_store.queue_recommend_next(session, [gate.id, other.id])

    assert job is not None and job.kind == JobKind.RECOMMEND_NEXT
    assert job.payload == {"candidate_ids": [str(gate.id), str(other.id)]}
    again = candidate_store.queue_recommend_next(session, [gate.id, other.id])
    assert again is None  # the same top N while one is queued: deduplicated

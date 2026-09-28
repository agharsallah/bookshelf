"""The cross-paper claim tracker (docs/PAPERS.md §5): pair selection, the relate_claims job
with a fake runner, claim nodes in the graph, and the claim points in Qdrant."""

import json
from collections.abc import Sequence

from qdrant_client import QdrantClient
from sqlmodel import Session, select

from app.core.config import get_settings
from app.graph import atlas
from app.graph.neighborhood import neighborhood
from app.graph.refs import Ref, resolve_ref
from app.jobs.queue import JobSpec
from app.models import Edge, Job
from app.models.enums import DocumentStatus, EdgeStatus, EntityKind, JobKind, JobState, Relation
from app.papers import claim_pairs
from app.retrieval.client import Collection, collection_name
from app.retrieval.collections import ensure_collections
from app.retrieval.embedding import FakeEmbedder
from app.retrieval.indexing import index_document
from tests.papers.claim_fixtures import (
    ATTENTION,
    PARALLEL,
    RECURRENT,
    UNRELATED,
    claims_of,
    two_papers,
)
from tests.papers.conftest import job_context

VECTORS = {
    ATTENTION: [1.0, 0.0, 0.0],
    RECURRENT: [0.8, 0.6, 0.0],  # cosine 0.8 with ATTENTION: a candidate
    PARALLEL: [0.0, 1.0, 0.0],  # cosine 0.6 with RECURRENT: under a 0.7 bar
    UNRELATED: [0.0, 0.0, 1.0],
}
SUPPORTS = json.dumps({"relation": "supports", "direction": "b_to_a", "confidence": "high",
                       "rationale": "B1 and A1 report BLEU on the same benchmark.",
                       "evidence": ["A1", "B1"]})  # fmt: skip
NONE = json.dumps({"relation": "none", "direction": "a_to_b", "confidence": "high",
                   "rationale": "Different models.", "evidence": []})  # fmt: skip


class TableEmbedder:
    """Vectors chosen per claim text, so a test sets similarities exactly."""

    def __init__(self) -> None:
        self.calls: list[str] = []

    def dense(self, texts: Sequence[str]) -> list[list[float]]:
        self.calls.extend(texts)
        return [VECTORS.get(t, [0.0, 0.0, 0.0]) for t in texts]


def relate(session: Session, doc_id, runner, threshold: float = 0.7):  # type: ignore[no-untyped-def]
    ctx = job_context(
        session, JobSpec(kind=JobKind.RELATE_CLAIMS, document_id=doc_id,
                         payload={"threshold": threshold}, input_hash=str(threshold))
    )  # fmt: skip
    return claim_pairs.run_relate_job(
        session, ctx.job, runner=runner, embedder=TableEmbedder(),
        skills_dir=get_settings().skills_dir,
    )  # fmt: skip


def test_candidates_pair_claims_of_different_papers_above_the_bar(session):
    a, _ = two_papers(session)

    found = claim_pairs.candidates(
        session, vectors=TableEmbedder().dense, threshold=0.7, limit=10, document_id=a.id
    )

    assert [(c.a.text, c.b.text, round(c.similarity, 2)) for c in found] == [
        (ATTENTION, RECURRENT, 0.8)
    ]
    lowered = claim_pairs.candidates(session, vectors=TableEmbedder().dense, threshold=0.5,
                                     limit=10)  # fmt: skip
    assert {frozenset((c.a.text, c.b.text)) for c in lowered} == {
        frozenset((ATTENTION, RECURRENT)), frozenset((PARALLEL, RECURRENT))
    }  # fmt: skip


def test_a_relation_lands_as_a_proposed_claim_edge_citing_both_papers(session):
    from app.pipeline.runner import FakeRunner

    a, b = two_papers(session)
    runner = FakeRunner(SUPPORTS)

    outcome = relate(session, a.id, runner)

    assert outcome.state is JobState.DONE and outcome.result["proposed"] == 1
    prompt = runner.calls[0]["prompt"]
    assert ATTENTION in prompt and RECURRENT in prompt and "28.4 BLEU" in prompt
    edge = session.exec(select(Edge)).one()
    attention, recurrent = claims_of(session, a)[ATTENTION], claims_of(session, b)[RECURRENT]
    assert (edge.src_kind, edge.src_id, edge.dst_kind, edge.dst_id) == (
        EntityKind.CLAIM, str(recurrent.id), EntityKind.CLAIM, str(attention.id)
    )  # fmt: skip
    assert (edge.relation, edge.status, edge.weight) == (
        Relation.SUPPORTS, EdgeStatus.PROPOSED, 0.8
    )  # fmt: skip
    assert edge.evidence == [f"{a.id}#ch03/p001", f"{b.id}#ch03/p001"]
    assert edge.meta["rationale"].startswith("B1 and A1")


def test_none_is_stored_rejected_and_a_pair_is_never_asked_twice(session):
    from app.pipeline.runner import FakeRunner

    a, b = two_papers(session)
    first = relate(session, a.id, FakeRunner(NONE))
    assert first.result["proposed"] == 0
    edge = session.exec(select(Edge)).one()
    assert edge.status is EdgeStatus.REJECTED

    again = FakeRunner(SUPPORTS)
    second = relate(session, b.id, again, threshold=0.75)

    assert second.state is JobState.SKIPPED and again.calls == []


def test_a_one_sided_verdict_is_retried_with_the_problem(session):
    from app.pipeline.runner import FakeRunner

    a, _ = two_papers(session)
    one_sided = json.dumps({**json.loads(SUPPORTS), "evidence": ["A1"]})
    runner = FakeRunner(one_sided, SUPPORTS)

    relate(session, a.id, runner)

    assert "evidence from both papers" in runner.calls[1]["prompt"]


def test_an_extends_that_runs_backwards_in_time_is_retried_with_the_years(session):
    # A real run had BERT (2019) and the Transformer (2017) right in its rationale ("A builds
    # on B") and the direction the wrong way round: the 2017 paper "extending" the 2019 one.
    from app.pipeline.runner import FakeRunner

    a, b = two_papers(session)
    a.year, b.year = 2017, 2014
    session.add_all([a, b])
    session.commit()
    extends = {"relation": "extends", "confidence": "high", "rationale": "A builds on B.",
               "evidence": ["A1", "B1"]}  # fmt: skip
    backwards = json.dumps({**extends, "direction": "b_to_a"})
    runner = FakeRunner(backwards, json.dumps({**extends, "direction": "a_to_b"}))

    relate(session, a.id, runner)

    assert "older than the one it would extend" in runner.calls[1]["prompt"]
    [edge] = session.exec(select(Edge).where(Edge.relation == Relation.EXTENDS)).all()
    assert (edge.src_id, edge.dst_id) == (
        str(claims_of(session, a)[ATTENTION].id),
        str(claims_of(session, b)[RECURRENT].id),
    )


def test_new_claims_queue_a_relate_job_the_worker_can_run(session):
    from app.jobs.registry import get_handler

    a, _ = two_papers(session)
    job = session.exec(
        select(Job).where(Job.document_id == a.id, Job.kind == JobKind.RELATE_CLAIMS)
    ).one()
    assert job.priority == claim_pairs.RELATE_PRIORITY
    import app.pipeline.handlers.paper_claims  # noqa: F401  (autodiscovered by the worker)

    assert get_handler(JobKind.RELATE_CLAIMS) is not None


# --- Graph -------------------------------------------------------------------------------


def _accepted_edge(session: Session) -> tuple[Edge, str, str]:
    from app.pipeline.runner import FakeRunner

    a, b = two_papers(session)
    relate(session, a.id, FakeRunner(SUPPORTS))
    edge = session.exec(select(Edge)).one()
    edge.status = EdgeStatus.ACCEPTED
    session.add(edge)
    session.commit()
    return edge, str(claims_of(session, a)[ATTENTION].id), str(claims_of(session, b)[RECURRENT].id)


def test_a_claim_ref_resolves_and_its_neighbourhood_shows_the_other_claim(session):
    _, attention, recurrent = _accepted_edge(session)

    focus = resolve_ref(session, attention)  # a bare uuid finds the claim
    hood = neighborhood(session, focus)

    assert focus == Ref(EntityKind.CLAIM, attention)
    other = next(n for n in hood.nodes if n.ref.id == recurrent)
    assert other.label is not None and other.label.label == RECURRENT
    assert other.label.sublabel == "Bahdanau · C1"
    assert other.label.anchor == "ch03/p001"
    assert [(e.src.id, e.dst.id) for e in hood.edges] == [(recurrent, attention)]


def test_the_atlas_folds_claims_to_their_units(session):
    edge, _, _ = _accepted_edge(session)

    view = atlas.atlas(session)

    folded = [e for e in view.edges if e.relation == "supports"]
    assert len(folded) == 1 and folded[0].edge_ids == [edge.id]
    assert folded[0].src.endswith("#ch03") and folded[0].dst.endswith("#ch03")


def test_edge_review_accepts_a_proposed_claim_edge(client, session):
    from app.pipeline.runner import FakeRunner
    from tests.conftest import AUTH

    a, _ = two_papers(session)
    relate(session, a.id, FakeRunner(SUPPORTS))
    edge = session.exec(select(Edge)).one()

    response = client.patch(f"/api/v1/edges/{edge.id}", json={"status": "accepted"},
                            headers=AUTH)  # fmt: skip

    assert response.status_code == 200, response.text
    assert response.json()["src"]["kind"] == "claim"
    assert response.json()["src"]["label"].startswith("A recurrent encoder")


# --- Qdrant points -----------------------------------------------------------------------


def test_embed_syncs_claim_points_and_deletes_stale_ones(session):
    from tests.papers.claim_fixtures import approve_claims, claim, claim_set

    client = QdrantClient(":memory:")
    embedder = FakeEmbedder()
    ensure_collections(dense_dim=embedder.dense_dim, client=client)
    a, _ = two_papers(session, status=DocumentStatus.INDEXED)
    name = collection_name(Collection.CLAIMS)

    first = index_document(session, a, embedder=embedder, client=client)
    assert first["claims"]["embedded"] == 2
    points = {str(p.id): p.payload for p in client.scroll(name, limit=10)[0]}
    attention = claims_of(session, a)[ATTENTION]
    assert points[str(attention.id)]["strength"] == "measured"

    approve_claims(session, a, claim_set(claim("C1", ATTENTION)), version=2)
    second = index_document(session, a, embedder=embedder, client=client)

    assert (second["claims"]["deleted"], second["claims"]["embedded"]) == (1, 0)
    assert [str(p.id) for p in client.scroll(name, limit=10)[0]] == [str(attention.id)]
    client.close()

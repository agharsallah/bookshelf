"""Paper linking and the citation graph (docs/PAPERS.md §3, §5): embed → link-paper-concepts
→ graph refresh, and `document —cites→ document` edges from the bibliography."""

import json
from pathlib import Path

import pytest
from sqlmodel import Session, select

from app.core.config import get_settings
from app.graph.atlas import atlas
from app.graph.neighborhood import neighborhood
from app.graph.refs import Ref
from app.jobs import queue
from app.jobs.queue import JobSpec
from app.models import Concept, Document, Edge, Job, PaperReference
from app.models.enums import (
    ArtifactType,
    CitationIntent,
    ConceptKind,
    DocumentStatus,
    EntityKind,
    JobKind,
    JobState,
    Relation,
    Review,
)
from app.papers import cites
from app.pipeline import orchestrator
from app.pipeline.execution import execute_skill_job
from app.pipeline.runner import FakeRunner
from app.services.documents import delete_document
from tests.papers.paper_fixtures import UNITS, add_paper, store
from tests.pipeline.runtime.conftest import BOOK, add_document, add_nodes, body, paragraph, span

SKILLS_DIR = get_settings().skills_dir


def done(session: Session, doc: Document, kind: JobKind, **payload) -> Job:
    job = queue.enqueue(session, JobSpec(kind=kind, document_id=doc.id, payload=payload or None))
    assert job is not None
    queue.complete(session, job, state=JobState.DONE)
    return job


def queued(session: Session) -> set[JobKind]:
    return {j.kind for j in session.exec(select(Job).where(Job.state == JobState.QUEUED))}


def cites_edges(session: Session) -> list[Edge]:
    session.expire_all()
    return list(session.exec(select(Edge).where(Edge.relation == Relation.CITES)).all())


def doc_ref(doc: Document) -> Ref:
    return Ref(EntityKind.DOCUMENT, str(doc.id))


@pytest.fixture
def paper(session: Session) -> Document:
    return add_paper(session)


@pytest.fixture
def cited(session: Session, paper: Document) -> Document:
    """A second paper on the shelf, which the first one's reference 2 points at."""
    other = add_paper(session, slug="wu-gnmt")
    ref = session.exec(
        select(PaperReference).where(
            PaperReference.document_id == paper.id, PaperReference.ordinal == 2
        )
    ).one()
    ref.target_document_id = other.id
    session.add(ref)
    session.commit()
    return other


# --- embed → link_paper_concepts ------------------------------------------------------------


def test_a_papers_embed_links_it_with_the_paper_skill_and_a_books_with_link_concepts(
    session, paper
):
    book = add_document(session)
    add_nodes(session, book, BOOK)

    orchestrator.on_job_done(session, done(session, paper, JobKind.EMBED))
    orchestrator.on_job_done(session, done(session, book, JobKind.EMBED))

    jobs = session.exec(select(Job).where(Job.state == JobState.QUEUED)).all()
    assert {(j.document_id, j.kind) for j in jobs} == {
        (paper.id, JobKind.LINK_PAPER_CONCEPTS),
        (book.id, JobKind.LINK_CONCEPTS),
    }
    session.refresh(paper)
    assert paper.status is DocumentStatus.INDEXED


def test_the_semantic_embed_after_new_concepts_does_not_re_link_a_paper(session, paper):
    orchestrator.on_job_done(session, done(session, paper, JobKind.EMBED, reason="concepts"))

    assert JobKind.LINK_PAPER_CONCEPTS not in queued(session)


def test_re_embedding_a_linked_paper_does_not_re_link_it(session, paper):
    # Approved claims or study sets re-embed a linked paper; only new results re-link it.
    paper.status = DocumentStatus.LINKED
    session.add(paper)
    session.commit()

    orchestrator.on_job_done(session, done(session, paper, JobKind.EMBED))

    assert JobKind.LINK_PAPER_CONCEPTS not in queued(session)
    session.refresh(paper)
    assert paper.status is DocumentStatus.LINKED


def test_approved_results_re_link_an_indexed_paper_only(session, paper):
    results = store(session, paper, ArtifactType.RESULTS_TABLE, None, Review.APPROVED,
                    {"rows": []})  # fmt: skip
    assert orchestrator.on_review(session, results) == []

    paper.status = DocumentStatus.INDEXED
    session.add(paper)
    session.commit()
    enqueued = orchestrator.on_review(session, results)

    assert [j.kind for j in enqueued] == [JobKind.LINK_PAPER_CONCEPTS]


def links() -> dict:
    return {
        "concepts": [
            {"canonical": "transformer", "aliases": ["transformer (big)"], "kind": "method",
             "blurb": [span("An encoder-decoder of attention only.", "ch02/p001")]},
            {"canonical": "wmt 2014 english-german", "aliases": [], "kind": "dataset",
             "blurb": [span("The benchmark of the main result.", "ch03/p001")]},
        ],
        "edges": [
            {"src": {"kind": "node", "ref": "ch02/p001"},
             "dst": {"kind": "concept", "ref": "transformer"},
             "relation": "defines", "weight": 1, "evidence": ["ch02/p001"]},
            {"src": {"kind": "node", "ref": "ch03/t001"},
             "dst": {"kind": "concept", "ref": "wmt 2014 english-german"},
             "relation": "mentions", "weight": 0.7, "evidence": ["ch03/t001"]},
        ],
    }  # fmt: skip


def test_a_link_paper_concepts_run_enters_the_graph_with_paper_kinds(session, paper, cited):
    for unit in UNITS:
        store(session, paper, ArtifactType.CHAPTER_DISTILLATION, unit,
              content=body(paragraph(f"{unit} distilled", f"{unit}/p001")))  # fmt: skip
    store(session, paper, ArtifactType.RESULTS_TABLE, None, Review.APPROVED,
          {"rows": [{"method": "Transformer (big)", "cites": ["ch03/t001"]}]})  # fmt: skip
    job = queue.enqueue(session, JobSpec(kind=JobKind.LINK_PAPER_CONCEPTS, document_id=paper.id))
    assert job is not None
    runner = FakeRunner(json.dumps(links()))

    outcome = execute_skill_job(session, job, runner=runner, skills_dir=SKILLS_DIR,
                                media_dir=Path("/m"))  # fmt: skip
    queue.complete(session, job, state=outcome.state, result=outcome.result)
    orchestrator.on_job_done(session, job)

    prompt = runner.calls[0]["prompt"]
    assert '"results_table"' in prompt and "Transformer (big)" in prompt
    kinds = {c.canonical: c.kind for c in session.exec(select(Concept)).all()}
    assert kinds == {"transformer": ConceptKind.METHOD,
                     "wmt 2014 english-german": ConceptKind.DATASET}  # fmt: skip
    origins = {e.origin.split("#")[0] for e in session.exec(select(Edge)).all()}
    assert "skill:link-paper-concepts@1" in origins
    assert len(cites_edges(session)) == 1  # the refresh re-seeded the citation graph too
    session.refresh(paper)
    assert paper.status is DocumentStatus.LINKED


# --- cites edges ---------------------------------------------------------------------------


def test_a_reference_on_the_shelf_is_a_cites_edge_with_its_citing_passages(session, paper, cited):
    cites.refresh(session, paper.id)
    cites.refresh(session, paper.id)  # idempotent

    [edge] = cites_edges(session)
    assert (edge.src_kind, edge.src_id, edge.dst_kind, edge.dst_id) == (
        EntityKind.DOCUMENT, str(paper.id), EntityKind.DOCUMENT, str(cited.id)
    )  # fmt: skip
    assert edge.evidence == [f"{paper.id}#ch03/p001"]
    assert (edge.weight, edge.meta) == (cites.UNCLASSIFIED_WEIGHT, {"ordinal": 2, "intent": None})


def test_an_intent_weighs_the_edge_and_leads_its_evidence(session, paper, cited):
    cites.refresh(session, paper.id)
    ref = session.exec(
        select(PaperReference).where(PaperReference.target_document_id == cited.id)
    ).one()
    ref.intent, ref.intent_cites = CitationIntent.EXTENDS, ["ch03/p001"]
    ref.cited_at = ["ch01/p001", "ch03/p001"]
    session.add(ref)
    session.commit()

    cites.refresh(session, paper.id)

    [edge] = cites_edges(session)
    assert edge.weight == cites.INTENT_WEIGHTS[CitationIntent.EXTENDS]
    assert edge.evidence == [f"{paper.id}#ch03/p001", f"{paper.id}#ch01/p001"]
    assert edge.meta == {"ordinal": 2, "intent": "extends"}


def test_a_reference_leaving_the_shelf_loses_its_edge(session, paper, cited):
    cites.refresh(session, paper.id)
    ref = session.exec(
        select(PaperReference).where(PaperReference.target_document_id == cited.id)
    ).one()
    ref.target_document_id = None
    session.add(ref)
    session.commit()

    cites.refresh(session, paper.id)

    assert cites_edges(session) == []


def test_refreshing_the_cited_paper_seeds_the_papers_citing_it(session, paper, cited):
    cites.refresh(session, cited.id)

    assert [e.src_id for e in cites_edges(session)] == [str(paper.id)]


def test_deleting_a_paper_withdraws_its_cites_edges_both_ways(session, paper, cited):
    """Regression: the delete nulls the citers' `target_document_id` before the graph
    refresh, and the dead paper was never re-seeded, so its edges outlived it."""
    third = add_paper(session, slug="third")
    ref = session.exec(
        select(PaperReference).where(
            PaperReference.document_id == cited.id, PaperReference.ordinal == 2
        )
    ).one()
    ref.target_document_id = third.id  # cited —cites→ third, as well as paper —cites→ cited
    session.add(ref)
    session.commit()
    cites.refresh(session, cited.id)
    assert len(cites_edges(session)) == 2

    delete_document(session, session.get(Document, cited.id))

    assert cites_edges(session) == []


def test_enrichment_re_seeds_the_citation_graph(session, paper, cited):
    orchestrator.on_job_done(session, done(session, paper, JobKind.PAPER_ENRICH))

    assert len(cites_edges(session)) == 1


def test_cites_edges_show_on_the_atlas_and_in_a_papers_neighbourhood(session, paper, cited):
    cites.refresh(session, paper.id)

    shown = atlas(session)
    assert [(e.src, e.dst) for e in shown.edges if e.relation == "cites"] == [
        (str(doc_ref(paper)), str(doc_ref(cited)))
    ]
    around = neighborhood(session, doc_ref(paper))
    assert [(e.dst, e.relation) for e in around.edges] == [(doc_ref(cited), Relation.CITES)]

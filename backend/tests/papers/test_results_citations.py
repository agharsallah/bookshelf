"""extract-results and classify-citations (docs/PAPERS.md §4): vocabularies, selectors, the
cite gates, and the intents materializer.

The skills run through the real packages and the generic handler with a FakeRunner; the
catalogue test already checks each package's contract and example.
"""

import json
import math
import re
from pathlib import Path
from typing import Any

import pytest
from sqlmodel import Session, select

from app.core.config import get_settings
from app.jobs import queue
from app.jobs.queue import JobSpec
from app.models import Artifact, Document, PaperReference
from app.models.enums import (
    ArtifactType,
    CitationIntent,
    ConceptKind,
    JobKind,
    JobState,
    NodeKind,
    Relation,
    Review,
    Tier,
)
from app.papers.extraction_checks import check_citations, check_results
from app.papers.intents import sync_intents
from app.papers.selectors.citing import has_citations
from app.pipeline import gates, orchestrator
from app.pipeline.execution import execute_skill_job
from app.pipeline.runner import FakeRunner
from app.pipeline.selectors import select_inputs
from app.pipeline.skills import load_catalogue
from app.pipeline.tree import Tree
from tests.papers.paper_fixtures import PAPER, add_paper, store

SKILLS_DIR = get_settings().skills_dir
APPENDIX = [
    ("ch04", NodeKind.CHAPTER, "A Appendix", {"role": "appendix"}),
    ("ch04/p001", NodeKind.PARAGRAPH, "Hyperparameters are listed below.", {}),
    (
        "ch04/t001",
        NodeKind.TABLE,
        "Model | PPL",
        {"header": ["Model", "PPL"], "rows": [["Big", "4.3"]]},
    ),
]


def schema(name: str) -> dict[str, Any]:
    return load_catalogue(SKILLS_DIR)[name].schema


def with_appendix() -> list[tuple[str, NodeKind, str, dict[str, Any]]]:
    cut = next(i for i, n in enumerate(PAPER) if n[0] == "bm01")
    return [*PAPER[:cut], *APPENDIX, *PAPER[cut:]]


@pytest.fixture
def paper(session: Session) -> Document:
    return add_paper(session, nodes=with_appendix())


def row(**overrides: Any) -> dict[str, Any]:
    base = {
        "method": "Transformer (big)",
        "dataset": "WMT 2014 English-German",
        "metric": "BLEU",
        "value": 28.4,
        "unit": None,
        "higher_is_better": True,
        "is_proposed": True,
        "cites": ["ch03/t001"],
    }
    return {**base, **overrides}


def derive(session: Session, doc: Document, skill: str, *replies: dict[str, Any]):
    job = queue.enqueue(session, JobSpec(kind=JobKind.DERIVE, document_id=doc.id, skill=skill))
    assert job is not None
    runner = FakeRunner(*(json.dumps(r) for r in replies))
    outcome = execute_skill_job(
        session, job, runner=runner, skills_dir=SKILLS_DIR, media_dir=Path("/media")
    )
    return outcome, runner


# --- Vocabularies and shapes --------------------------------------------------------------


def test_citation_intents_are_the_enum():
    item = schema("classify-citations")["properties"]["citations"]["items"]
    assert set(item["properties"]["intent"]["enum"]) == {i.value for i in CitationIntent}


def test_link_paper_concepts_proposes_every_concept_kind_and_the_skill_relations():
    props = schema("link-paper-concepts")["properties"]
    kinds = props["concepts"]["items"]["properties"]["kind"]["enum"]
    relations = props["edges"]["items"]["properties"]["relation"]["enum"]
    assert set(kinds) == {k.value for k in ConceptKind}
    assert set(relations) == {r.value for r in Relation if not r.is_derived}


def test_a_result_value_must_be_a_number_and_cited():
    assert gates.schema_errors(schema("extract-results"), {"rows": [row()]}) == []
    assert gates.schema_errors(schema("extract-results"), {"rows": [row(value="28.4")]})
    assert gates.schema_errors(schema("extract-results"), {"rows": [row(cites=[])]})


def test_the_results_check_refuses_non_finite_values_and_repeated_rows():
    output = {
        "rows": [
            row(),
            row(value=math.nan),
            row(setting=" ± 0.1"),
            row(method="transformer  (BIG)"),
        ]
    }

    problems = check_results(output, None)  # type: ignore[arg-type]

    assert any("rows[1]" in p and "finite" in p for p in problems)
    assert [p for p in problems if "repeats" in p] == [
        next(p for p in problems if p.startswith("rows[1]") and "repeats" in p),
        next(p for p in problems if p.startswith("rows[3]")),
    ]


# --- extract-results -------------------------------------------------------------------


def test_results_read_the_results_unit_the_appendix_tables_and_their_explanations(session, paper):
    store(
        session,
        paper,
        ArtifactType.TABLE_EXPLANATION,
        "ch03/t001",
        content={"takeaway": "Big wins.", "blocks": []},
    )

    selection = select_inputs(session, "paper_results", paper, None)

    inputs = selection.inputs
    assert [u["anchor"] for u in inputs["units"]] == ["ch03"]
    assert [b["anchor"] for b in inputs["units"][0]["blocks"]] == ["ch03/p001", "ch03/t001"]
    assert [t["anchor"] for t in inputs["tables"]] == ["ch02/s01/f001", "ch04/t001"]
    assert [e["anchor"] for e in inputs["explanations"]] == ["ch03/t001"]
    assert selection.valid_anchors == {
        "ch03",
        "ch03/p001",
        "ch03/t001",
        "ch02/s01/f001",
        "ch04/t001",
    }


def test_the_cards_setup_names_come_along_without_their_anchors(session, paper):
    setup = {
        "datasets": [{"name": "WMT 2014 EN-DE", "spans": []}],
        "baselines": [],
        "metrics": [{"name": "BLEU", "spans": []}],
    }
    store(session, paper, ArtifactType.PAPER_CARD, None, Review.APPROVED, {"setup": setup})

    inputs = select_inputs(session, "paper_results", paper, None).inputs

    assert inputs["setup"] == {"datasets": ["WMT 2014 EN-DE"], "baselines": [], "metrics": ["BLEU"]}


def test_a_result_citing_the_introduction_is_retried_then_stored(session, paper):
    bad = {"rows": [row(cites=["ch01/p002"])]}
    good = {
        "rows": [
            row(),
            row(
                method="Big",
                dataset="newstest2013",
                metric="perplexity",
                value=4.3,
                higher_is_better=False,
                cites=["ch04/t001"],
            ),
        ]
    }

    outcome, runner = derive(session, paper, "extract-results", bad, good)

    assert outcome.state is JobState.DONE, outcome.result
    assert "ch01/p002" in runner.calls[1]["prompt"]
    artifact = session.get(Artifact, outcome.result["artifact_id"])
    assert artifact is not None and artifact.type is ArtifactType.RESULTS_TABLE
    assert len(artifact.body["rows"]) == 2
    assert runner.calls[0]["tier"] is Tier.DISTIL


# --- classify-citations ------------------------------------------------------------------

CITING = [
    ("ch01", NodeKind.CHAPTER, "1 Introduction", {"role": "introduction"}),
    (
        "ch01/p001",
        NodeKind.PARAGRAPH,
        "Recurrent models [1] dominate. They are slow, as Hochreiter et al. showed. "
        "Attention helps [2].",
        {},
    ),
    ("ch02", NodeKind.CHAPTER, "2 Method", {"role": "method"}),
    (
        "ch02/p001",
        NodeKind.PARAGRAPH,
        "We train with the optimizer of Kingma and Ba (2015) on eight GPUs.",
        {},
    ),
    ("bm01", NodeKind.CHAPTER, "References", {"role": "references", "skip": True}),
    ("bm01/p001", NodeKind.PARAGRAPH, "[1] Hochreiter. LSTM. 1997.", {}),
]


@pytest.fixture
def citing(session: Session) -> Document:
    doc = add_paper(session, slug="citing-paper", nodes=CITING)
    for ref in session.exec(select(PaperReference).where(PaperReference.document_id == doc.id)):
        session.delete(ref)
    session.commit()
    session.add_all(
        [
            PaperReference(
                document_id=doc.id, ordinal=1, raw="Hochreiter. LSTM. 1997.", cited_at=["ch01/p001"]
            ),
            PaperReference(
                document_id=doc.id, ordinal=2, raw="Bahdanau et al. 2015.", cited_at=["ch01/p001"]
            ),
            PaperReference(
                document_id=doc.id,
                ordinal=3,
                raw="Kingma and Ba. Adam. 2015.",
                authors=["Diederik P. Kingma", "Jimmy Ba"],
                year=2015,
                cited_at=["ch02/p001", "ch09/p001"],
            ),
            PaperReference(document_id=doc.id, ordinal=4, raw="Never cited.", cited_at=[]),
        ]
    )
    session.commit()
    return doc


def test_each_cited_reference_comes_with_the_sentence_holding_its_marker(session, citing):
    selection = select_inputs(session, "paper_citations", citing, None)

    refs = selection.inputs["references"]
    assert [r["ordinal"] for r in refs] == [1, 2, 3]  # the uncited entry has nothing to read
    assert refs[0]["contexts"] == [
        {"anchor": "ch01/p001", "role": "introduction", "text": "Recurrent models [1] dominate."}
    ]
    # a short sentence brings the one before it; `et al.` does not end a sentence
    assert refs[1]["contexts"][0]["text"] == (
        "They are slow, as Hochreiter et al. showed. Attention helps [2]."
    )
    assert refs[2]["contexts"] == [  # author-year, and the vanished anchor is dropped
        {
            "anchor": "ch02/p001",
            "role": "method",
            "text": "We train with the optimizer of Kingma and Ba (2015) on eight GPUs.",
        }
    ]
    assert selection.valid_anchors == {"ch01/p001", "ch02/p001"}


def test_a_verdict_citing_another_references_passage_is_sent_back(session, citing):
    bad = {"citations": [{"ordinal": 3, "intent": "uses", "cites": ["ch01/p001"]}]}
    good = {
        "citations": [
            {"ordinal": 1, "intent": "background", "cites": ["ch01/p001"]},
            {"ordinal": 3, "intent": "uses", "cites": ["ch02/p001"]},
        ]
    }

    outcome, runner = derive(session, citing, "classify-citations", bad, good)

    assert outcome.state is JobState.DONE, outcome.result
    assert "ordinal 3 cites ch01/p001" in runner.calls[1]["prompt"]
    assert runner.calls[0]["tier"] is Tier.EXPLORE


def test_the_citation_check_refuses_unknown_and_repeated_ordinals(session, citing):
    selection = select_inputs(session, "paper_citations", citing, None)
    output = {
        "citations": [
            {"ordinal": 9, "intent": "uses", "cites": ["ch01/p001"]},
            {"ordinal": 1, "intent": "uses", "cites": ["ch01/p001"]},
            {"ordinal": 1, "intent": "background", "cites": ["ch01/p001"]},
        ]
    }

    problems = check_citations(output, selection)

    assert problems == [
        "citations: ordinal 9 is not in inputs.references",
        "citations: ordinal 1 is classified twice; keep one",
    ]


# --- The intents materializer -------------------------------------------------------------


def intents(session: Session, doc: Document) -> dict[int, tuple[CitationIntent | None, list[str]]]:
    rows = session.exec(select(PaperReference).where(PaperReference.document_id == doc.id))
    found = {r.ordinal: (r.intent, list(r.intent_cites)) for r in rows}
    session.expire_all()
    return found


VERDICTS = {
    "citations": [
        {"ordinal": 1, "intent": "background", "cites": ["ch01/p001"]},
        {"ordinal": 3, "intent": "uses", "cites": ["ch02/p001", "ch01/p001"]},
        {"ordinal": 2, "intent": "extends", "cites": ["ch02/p001"]},  # not where [2] is cited
        {"ordinal": 7, "intent": "uses", "cites": ["ch01/p001"]},  # no such reference
    ]
}


def test_approving_intents_writes_them_onto_the_references(session, citing):
    artifact = store(
        session, citing, ArtifactType.CITATION_INTENTS, None, Review.APPROVED, VERDICTS
    )

    orchestrator.on_review(session, artifact)

    assert intents(session, citing) == {
        1: (CitationIntent.BACKGROUND, ["ch01/p001"]),
        2: (None, []),
        3: (CitationIntent.USES, ["ch02/p001"]),
        4: (None, []),
    }


def test_a_draft_writes_nothing_and_a_rejection_falls_back_to_the_previous_approval(
    session, citing
):
    first = store(session, citing, ArtifactType.CITATION_INTENTS, None, Review.APPROVED, VERDICTS)
    sync_intents(session, citing.id)
    newer = {"citations": [{"ordinal": 1, "intent": "contradicts", "cites": ["ch01/p001"]}]}
    draft = store(session, citing, ArtifactType.CITATION_INTENTS, None, Review.DRAFT, newer, 2)
    orchestrator.on_review(session, draft)
    assert intents(session, citing)[1] == (CitationIntent.BACKGROUND, ["ch01/p001"])

    draft.review = Review.APPROVED
    session.add(draft)
    session.commit()
    sync_intents(session, citing.id)
    assert intents(session, citing)[3] == (None, [])  # rebuilt from the newest approval only

    draft.review = Review.REJECTED
    session.add(draft)
    session.commit()
    orchestrator.on_review(session, draft)
    assert intents(session, citing)[3] == (CitationIntent.USES, ["ch02/p001"])

    first.review = Review.REJECTED
    session.add(first)
    session.commit()
    orchestrator.on_review(session, first)
    assert all(found == (None, []) for found in intents(session, citing).values())


def test_classify_citations_is_queued_only_for_a_paper_that_cites(session):
    cites = add_paper(session)
    # The same paper with its in-text markers removed: only the (skipped) bibliography keeps "[1]".
    silent = add_paper(
        session,
        slug="silent-paper",
        nodes=[
            (a, k, re.sub(r"\s*\[\d+\]", "", t) if a != "bm01/p001" else t, m)
            for a, k, t, m in PAPER
        ],
    )

    assert has_citations(Tree.load(session, cites))
    assert not has_citations(Tree.load(session, silent))

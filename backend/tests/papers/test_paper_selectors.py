"""The paper skills' input selectors (app/papers/selectors/)."""

from pathlib import Path

import pytest
from sqlmodel import Session

from app.models import Concept, Document, PaperMeta
from app.models.enums import ArtifactType, ConceptKind, Review
from app.pipeline.hashing import input_hash
from app.pipeline.selectors import SelectorError, select_inputs
from tests.papers.paper_fixtures import PAPER, UNITS, add_paper, store
from tests.pipeline.runtime.conftest import body, paragraph, span


def select(session: Session, selector: str, doc: Document, anchor: str | None = None):
    return select_inputs(session, selector, doc, anchor, media_dir=Path("/media"))


@pytest.fixture
def paper(session: Session) -> Document:
    return add_paper(session)


def distil_every_unit(session: Session, paper: Document) -> None:
    for unit in UNITS:
        store(session, paper, ArtifactType.CHAPTER_DISTILLATION, unit,
              content=body(paragraph(f"{unit} distilled", f"{unit}/p001")))  # fmt: skip


# --- paper_unit_blocks ---------------------------------------------------------------------


def test_a_unit_brings_its_blocks_role_subsections_and_figures(session, paper):
    store(session, paper, ArtifactType.MATH_DESCRIPTION, "ch02/s01/m001", Review.APPROVED,
          content=body(paragraph("Softmax of scaled scores.", "ch02/s01/m001"),
                       takeaway=span("Scaled attention.", "ch02/s01/m001")))  # fmt: skip

    inputs = select(session, "paper_unit_blocks", paper, "ch02").inputs

    assert inputs["role"] == "method"
    assert [b["anchor"] for b in inputs["blocks"]] == [
        "ch02/p001", "ch02/s01/p001", "ch02/s01/m001", "ch02/s01/f001",
    ]  # fmt: skip
    assert inputs["blocks"][2]["meta"]["latex"].startswith(r"\mathrm{Attention}")
    assert inputs["subsections"] == [
        {"anchor": "ch02/s01", "heading": "2.1 Scaled Dot-Product Attention"}
    ]
    assert [f["anchor"] for f in inputs["figures"]] == ["ch02/s01/m001"]


def test_a_units_figure_explanations_count_as_source_for_compression(session, paper):
    # The note may copy a figure's checked explanation, so its words are source too.
    bare = select(session, "paper_unit_blocks", paper, "ch02").source_words
    store(session, paper, ArtifactType.MATH_DESCRIPTION, "ch02/s01/m001", Review.APPROVED,
          content=body(paragraph("Softmax of scaled scores.", "ch02/s01/m001"),
                       takeaway=span("Scaled attention.", "ch02/s01/m001")))  # fmt: skip

    assert select(session, "paper_unit_blocks", paper, "ch02").source_words == bare + 4


def test_a_unit_names_only_the_references_it_cites(session, paper):
    intro = select(session, "paper_unit_blocks", paper, "ch01").inputs
    method = select(session, "paper_unit_blocks", paper, "ch02").inputs

    assert intro["references"] == [{"ordinal": 1, "raw": "Hochreiter and Schmidhuber. LSTM. 1997."}]
    assert method["references"] == []


def test_the_abstract_and_outline_orient_a_unit_without_anchors_to_cite(session, paper):
    selection = select(session, "paper_unit_blocks", paper, "ch03")

    assert selection.inputs["paper"] == {
        "outline": [
            {"heading": "1 Introduction", "role": "introduction"},
            {"heading": "2 Model Architecture", "role": "method"},
            {"heading": "3 Results", "role": "results"},
        ],
        "abstract": "We propose a model based solely on attention.",
    }
    assert selection.visible_anchors is not None
    assert "fm01/p001" not in selection.visible_anchors  # citing it flags out_of_scope_cites
    assert "ch01" not in selection.visible_anchors


@pytest.mark.parametrize("anchor", ["fm01", "ch02/s01", "ch02/p001"])
def test_only_a_unit_can_be_distilled(session, paper, anchor):
    with pytest.raises(SelectorError, match="not a unit"):
        select(session, "paper_unit_blocks", paper, anchor)


def test_the_bibliography_is_not_a_unit(session, paper):
    with pytest.raises(SelectorError, match="skipped container"):
        select(session, "paper_unit_blocks", paper, "bm01")


# --- paper_distillations / paper_explainer ------------------------------------------------


def test_the_card_input_waits_for_a_unit_distillation(session, paper):
    with pytest.raises(SelectorError, match="no unit distillations"):
        select(session, "paper_distillations", paper)


def test_the_card_reads_every_unit_distillation_the_abstract_and_stable_meta(session, paper):
    distil_every_unit(session, paper)

    selection = select(session, "paper_distillations", paper)

    inputs = selection.inputs
    assert [(d["anchor"], d["role"]) for d in inputs["unit_distillations"]] == [
        ("ch01", "introduction"), ("ch02", "method"), ("ch03", "results"),
    ]  # fmt: skip
    assert inputs["abstract"] == {
        "anchor": "fm01",
        "blocks": [{"anchor": "fm01/p001", "kind": "paragraph", "page": 1, "meta": {},
                    "text": "We propose a model based solely on attention."}],
    }  # fmt: skip
    assert inputs["paper_meta"] == {
        "doi": "10.48550/arxiv.1706.03762", "arxiv_id": "1706.03762", "venue": "NeurIPS",
        "year": 2017, "code_urls": ["https://github.com/tensorflow/tensor2tensor"],
        "data_urls": [],
    }  # fmt: skip
    assert selection.chapters == tuple(UNITS)  # the coverage gate's denominator


def test_enrichment_refreshing_counts_does_not_change_the_card_input(session, paper):
    distil_every_unit(session, paper)
    before = select(session, "paper_distillations", paper).inputs

    meta = session.get(PaperMeta, paper.id)
    assert meta is not None
    meta.cited_by_count, meta.fields = 150_000, ["Machine translation"]
    session.add(meta)
    session.commit()

    after = select(session, "paper_distillations", paper).inputs
    assert input_hash("dissect-paper", "1", before) == input_hash("dissect-paper", "1", after)


def test_without_an_abstract_section_the_meta_abstract_is_uncitable_context(session):
    paper = add_paper(session, nodes=[n for n in PAPER if not n[0].startswith("fm01")])
    distil_every_unit(session, paper)

    inputs = select(session, "paper_distillations", paper).inputs

    assert inputs["abstract"] == {
        "anchor": None, "text": "We propose a model based solely on attention."
    }  # fmt: skip


def test_the_explainer_adds_the_preferred_card_and_the_shelf_concepts(session, paper):
    distil_every_unit(session, paper)
    store(session, paper, ArtifactType.PAPER_CARD, None, Review.APPROVED,
          content={"tldr": [span("approved card", "ch03/p001")]})  # fmt: skip
    store(session, paper, ArtifactType.PAPER_CARD, None,
          content={"tldr": [span("newer draft", "ch03/p001")]}, version=2)  # fmt: skip
    session.add(Concept(canonical="attention", aliases=["attention mechanism"],
                        kind=ConceptKind.CONCEPT))  # fmt: skip
    session.commit()

    inputs = select(session, "paper_explainer", paper).inputs

    assert inputs["paper_card"] == {"tldr": [span("approved card", "ch03/p001")]}
    assert inputs["existing_concepts"] == [
        {"canonical": "attention", "aliases": ["attention mechanism"], "kind": "concept"}
    ]
    assert len(inputs["unit_distillations"]) == len(UNITS)


def test_the_explainer_runs_before_a_card_exists(session, paper):
    distil_every_unit(session, paper)

    assert select(session, "paper_explainer", paper).inputs["paper_card"] is None

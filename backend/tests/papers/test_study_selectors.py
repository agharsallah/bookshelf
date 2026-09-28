"""The study and critique skills' selectors (app/papers/selectors/study.py)."""

from pathlib import Path

import pytest
from sqlmodel import Session

from app.models import Concept, Document
from app.models.enums import ArtifactType, ConceptKind, Review
from app.papers.selectors.study import has_math
from app.pipeline.selectors import SelectorError, select_inputs
from app.pipeline.tree import Tree
from tests.papers.paper_fixtures import UNITS, add_paper, store, without_elements
from tests.pipeline.runtime.conftest import add_document, body, paragraph, span


def select(session: Session, selector: str, doc: Document):
    return select_inputs(session, selector, doc, None, media_dir=Path("/media"))


@pytest.fixture
def paper(session: Session) -> Document:
    return add_paper(session)


def distil_every_unit(session: Session, paper: Document) -> None:
    for unit in UNITS:
        store(session, paper, ArtifactType.CHAPTER_DISTILLATION, unit,
              content=body(paragraph(f"{unit} distilled", f"{unit}/p001")))  # fmt: skip


def card(tldr: str) -> dict:
    return {"tldr": [span(tldr, "ch01/p001")]}


# --- paper_assessment / paper_review ----------------------------------------------------


def test_the_assessment_sees_the_paper_its_card_and_the_shelf(session, paper):
    distil_every_unit(session, paper)
    store(session, paper, ArtifactType.PAPER_CARD, None, Review.APPROVED,
          content=card("Attention is all you need."))  # fmt: skip
    other = add_paper(session, slug="devlin-bert")
    store(session, other, ArtifactType.PAPER_CARD, None, content=card("Pre-train, then tune."))
    store(session, other, ArtifactType.PAPER_CARD, None, Review.REJECTED, version=2,
          content=card("A rejected card."))  # fmt: skip
    book = add_document(session, slug="meadows-systems")
    store(session, book, ArtifactType.PAPER_CARD, None, Review.NEEDS_REVIEW,
          content=card("Not a paper."))  # fmt: skip
    session.add(Concept(canonical="attention", kind=ConceptKind.METHOD))
    session.commit()

    selection = select(session, "paper_assessment", paper)

    inputs = selection.inputs
    assert inputs["paper_card"] == card("Attention is all you need.")
    assert [d["anchor"] for d in inputs["unit_distillations"]] == UNITS
    assert [(p["slug"], p["tldr"]) for p in inputs["shelf"]["papers"]] == [
        ("devlin-bert", "Pre-train, then tune.")
    ]  # itself, rejected cards and books are left out
    assert [c["canonical"] for c in inputs["shelf"]["concepts"]] == ["attention"]
    assert selection.chapters == tuple(UNITS)


def test_the_review_reads_the_whole_paper_and_waits_for_its_distillations(session, paper):
    with pytest.raises(SelectorError, match="no unit distillations"):
        select(session, "paper_review", paper)

    distil_every_unit(session, paper)
    inputs = select(session, "paper_review", paper).inputs

    assert inputs["paper_card"] is None
    assert "shelf" not in inputs
    assert inputs["abstract"]["anchor"] == "fm01"


# --- paper_notation -----------------------------------------------------------------------


def test_notation_offers_each_formula_with_the_prose_around_it_in_reading_order(session, paper):
    store(session, paper, ArtifactType.MATH_DESCRIPTION, "ch02/s01/m001", Review.APPROVED,
          content=body(paragraph("Q, K, V are queries, keys and values.", "ch02/s01/m001"),
                       takeaway=span("Scaled attention.", "ch02/s01/m001")))  # fmt: skip

    inputs = select(session, "paper_notation", paper).inputs

    # The paragraph before; after it a figure (not prose) and the next chapter (out of reach).
    assert [b["anchor"] for b in inputs["blocks"]] == ["ch02/s01/p001", "ch02/s01/m001"]
    assert inputs["blocks"][1]["meta"]["latex"].startswith(r"\mathrm{Attention}")
    assert [d["anchor"] for d in inputs["math_descriptions"]] == ["ch02/s01/m001"]
    assert inputs["math_descriptions"][0]["takeaway"]["text"] == "Scaled attention."


def test_a_paper_without_formulas_has_no_notation_input(session):
    no_math = add_paper(session, nodes=without_elements())

    assert not has_math(Tree.load(session, no_math))
    with pytest.raises(SelectorError, match="no formulas"):
        select(session, "paper_notation", no_math)


def test_formulas_a_distillation_wrote_out_from_prose_are_offered_with_that_prose(session):
    # BERT writes `s_null = S·C + E·C` inline in a paragraph: the parser sees prose, the unit
    # note writes it as a `math` block citing that paragraph.
    no_math = add_paper(session, nodes=without_elements())
    null_score = {"type": "math", "latex": r"s_{null} = S \cdot C + E \cdot C",
                  "meaning": [span("Score of the no-answer span.", "ch03/p001")],
                  "cites": ["ch03/p001", "ch03/nope"]}  # fmt: skip
    store(session, no_math, ArtifactType.CHAPTER_DISTILLATION, "ch03",
          content={"blocks": [paragraph("Results.", "ch03/p001"), null_score]})  # fmt: skip

    inputs = select(session, "paper_notation", no_math).inputs

    assert inputs["distilled_formulas"] == [{
        "latex": r"s_{null} = S \cdot C + E \cdot C",
        "meaning": "Score of the no-answer span.",
        "cites": ["ch03/p001"],
    }]  # fmt: skip
    assert [b["anchor"] for b in inputs["blocks"]] == ["ch03/p001"]


# --- paper_journal_club ---------------------------------------------------------------------


def test_the_journal_club_picks_from_the_papers_figures_with_their_explanations(session, paper):
    distil_every_unit(session, paper)
    store(session, paper, ArtifactType.FIGURE_DESCRIPTION, "ch02/s01/f001", Review.APPROVED,
          content=body(paragraph("Scores flow into a softmax.", "ch02/s01/f001"),
                       takeaway=span("The attention function.", "ch02/s01/f001")))  # fmt: skip

    inputs = select(session, "paper_journal_club", paper).inputs

    assert inputs["figures"] == [
        {
            "anchor": "ch02/s01/f001",
            "caption": "Figure 1: The attention function",
            "explanation": {
                "takeaway": span("The attention function.", "ch02/s01/f001"),
                "blocks": [paragraph("Scores flow into a softmax.", "ch02/s01/f001")],
            },
        }
    ]  # tables (ch03/t001) and formulas are not figures

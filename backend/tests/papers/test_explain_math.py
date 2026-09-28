"""explain-math: its schema, its selector, the cross-field gates of `app.papers.math_checks`
(formulas, symbols, arithmetic, diagrams), a real run on the fixture paper through the
generic handler, and its rendering for exports and search."""

import copy
import json
from pathlib import Path
from typing import Any

import pytest
from sqlmodel import Session

from app.jobs import queue
from app.jobs.queue import JobSpec
from app.models import Concept, Document
from app.models.enums import ArtifactType, ConceptKind, JobKind, Review, Tier
from app.papers.math_checks import (
    arithmetic_problems,
    check_math_explainer,
    same_formula,
    symbol_atoms,
)
from app.pipeline.bodies import leaf_spans
from app.pipeline.execution import execute_skill_job
from app.pipeline.runner import FakeRunner
from app.pipeline.selectors import Selection, SelectorError, select_inputs
from app.retrieval.points import INDEXED_TYPES, flatten_body
from app.services.render_markdown import body_blocks, render_blocks
from tests.papers.paper_fixtures import ATTENTION_LATEX, add_paper, store, without_elements
from tests.papers.test_paper_skills import SKILLS_DIR, example, run, schema_problems, stored
from tests.pipeline.runtime.conftest import span

SKILL = "explain-math"
TIMES, MINUS, SIGMA = "\u00d7", "\u2212", "\u03c3"


# --- Pure pieces ------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("text", "wrong"),
    [
        (f"0.5 {TIMES} 1 + 1 {TIMES} 2 = 2.5.", False),
        ("1 / (1 + 0.08) ≈ 0.93", False),  # rounded, and marked so
        ("1/3 = 0.33", False),  # rounded to the precision written
        ("1,000 * 2 = 2,000", False),  # thousands separators
        (f"2 {MINUS} 3 = {MINUS}1", False),
        (f"{SIGMA}(2.5) = 1 / (1 + e^(-2.5))", False),  # not plain arithmetic: left alone
        ("The dimension d = 512.", False),  # no operation
        ("Step 2. 3 * 4 = 13 now", True),
        ("0.45 / 0.5 = 0.8", True),
        ("2 + 2 = 4.1", True),
    ],
)
def test_worked_arithmetic_is_recomputed_at_its_written_precision(text, wrong):
    assert bool(arithmetic_problems(text)) is wrong


def test_a_wrong_sum_says_what_it_should_be():
    assert arithmetic_problems("0.45 / 0.5 = 0.8") == ["0.45 / 0.5 = 0.8 is wrong (it is 0.9)"]


def test_symbols_are_letters_outside_scripts_not_names_or_operators():
    assert symbol_atoms(ATTENTION_LATEX) == {"Q", "K", "V", "d"}
    assert symbol_atoms(r"\alpha_i' = \frac{g_i \alpha_i}{\sum_j g_j \alpha_j}") == {"alpha", "g"}
    assert symbol_atoms(r"\mathbf{W}^Q") == {"W"}
    assert symbol_atoms(SIGMA) == symbol_atoms(r"\sigma") == {"sigma"}


def test_two_spellings_or_one_line_of_a_formula_match_its_source():
    assert same_formula(r"g_i=\sigma(w^\top[q;p_i])", r"g_i = \sigma(w^\top [q; p_i]).")
    assert same_formula(r"a = b", r"a = b \\ c = d")  # one line of an align
    assert not same_formula(r"g_i = \tanh(w^\top q)", r"g_i = \sigma(w^\top [q; p_i])")


# --- The example and its inputs ------------------------------------------------------------

EXAMPLE_INPUTS: dict[str, Any] = {
    "blocks": [
        {"anchor": "ch03/s01/p001", "kind": "paragraph", "text": "Let q …", "meta": {}},
        {"anchor": "ch03/s01/m001", "kind": "math", "text": "",
         "meta": {"latex": r"g_i = \sigma(w^\top [q; p_i])"}},
        {"anchor": "ch03/s01/p002", "kind": "paragraph", "text": "where w …", "meta": {}},
        {"anchor": "ch03/s01/p003", "kind": "paragraph", "text": "The reader …", "meta": {}},
        {"anchor": "ch03/s01/m002", "kind": "math", "text": "",
         "meta": {"latex": r"\alpha_i' = \frac{g_i \alpha_i}{\sum_j g_j \alpha_j}"}},
    ],
    "math_descriptions": [],
    "distilled_formulas": [],
    "notation_table": None,
    "paper_card": {"tldr": [span("Irrelevant passages dilute the evidence.", "ch01/p002"),
                            span("+2.1 EM.", "ch04/s02/p001")]},
    "existing_concepts": [{"canonical": "attention", "aliases": [], "kind": "concept"}],
}  # fmt: skip


def check(output: dict[str, Any], inputs: dict[str, Any] = EXAMPLE_INPUTS) -> list[str]:
    selection = Selection(inputs=inputs, source_words=100, valid_anchors=frozenset())
    return check_math_explainer(output, selection)


def mutated(change) -> dict[str, Any]:
    output = copy.deepcopy(example(SKILL))
    change(output)
    return output


def test_the_example_satisfies_its_schema_and_its_checks():
    assert schema_problems(SKILL, example(SKILL)) == []
    assert check(example(SKILL)) == []


def _confusion_as_insight(out):
    out["formulas"][0]["common_confusion"]["tone"] = "insight"


def _extra_as_paragraph(out):
    extra = {"type": "paragraph", "spans": [span("x", "ch03/s01/m001")]}
    out["formulas"][0]["worked_example"]["extra"] = extra


def _answer_missing(out):
    del out["formulas"][0]["try_it"]["answer"]


def _no_formulas(out):
    out["formulas"] = []


def _minutes_as_text(out):
    out["path"][0]["minutes"] = "5 min"


BROKEN = [_confusion_as_insight, _extra_as_paragraph, _answer_missing, _no_formulas,
          _minutes_as_text]  # fmt: skip


@pytest.mark.parametrize("mutate", BROKEN, ids=[m.__name__ for m in BROKEN])
def test_the_schema_enforces_the_shape(mutate):
    assert schema_problems(SKILL, mutated(mutate)) != []


def _set(path: str, value: Any):
    def change(out):
        *parents, last = path.split(".")
        target = out
        for key in parents:
            target = target[int(key)] if key.isdigit() else target[key]
        target[int(last) if last.isdigit() else last] = value

    return change


@pytest.mark.parametrize(
    ("change", "problem"),
    [
        (_set("formulas.1.anchor", "ch03/s01/p003"), "ch03/s01/p003 is not a formula of the input"),
        (_set("formulas.0.anchor", "ch03/s01/m002"), "ch03/s01/m002 is explained twice"),
        (_set("formulas.0.latex", r"g_i = \tanh(w^\top q)"), "latex does not match the source"),
        (_set("formulas.1.symbols", [{"symbol": "g_i", "everyday": [span("x", "ch03/s01/m002")]}]),
         "uses alpha without explaining them"),
        (_set("formulas.1.worked_example.steps.items.1",
              [span("Add them up: 0.45 + 0.05 = 0.55.", "ch03/s01/m002")]),
         "0.45 + 0.05 = 0.55 is wrong (it is 0.5)"),
        (_set("formulas.0.try_it.answer", [span("1 / (1 + 1) = 0.4.", "ch03/s01/m001")]),
         "1 / (1 + 1) = 0.4 is wrong"),
        (_set("formulas.0.diagram.edges.0.to", "nowhere"), "diagram: edges point at missing nodes"),
        (_set("big_picture.map.nodes.1.id", "inputs"), "map: node id 'inputs' repeats"),
        (_set("path.1.formula", "ch03/s01/p001"), "which is not one of formulas[].anchor"),
        (_set("formulas.0.explore_further.prerequisites.0.shelf_concept", "dot product"),
         "shelf_concept 'dot product' is not a canonical"),
        (_set("formulas.0.why_here", [span("Made up.", "ch09/p001")]),
         "cites anchors the input does not offer: ['ch09/p001']"),
    ],
    ids=["not-a-formula", "twice", "latex", "symbol", "arithmetic", "answer", "edge", "node",
         "path", "shelf", "cite"],
)  # fmt: skip
def test_each_cross_field_rule_is_checked(change, problem):
    problems = check(mutated(change))

    assert any(problem in p for p in problems), problems


def test_an_inline_formula_is_explained_from_the_prose_its_distilled_formula_cites():
    latex = r"\alpha_i' = \frac{g_i \alpha_i}{\sum_j g_j \alpha_j}"
    inline = {"latex": latex, "meaning": "Re-weighted attention.", "cites": ["ch03/s01/p003"]}
    inputs = {**EXAMPLE_INPUTS, "distilled_formulas": [inline]}
    output = mutated(_set("formulas.1.anchor", "ch03/s01/p003"))
    output["path"][2]["formula"] = "ch03/s01/p003"

    assert check(output, inputs) == []


def test_a_long_formula_section_is_sent_back_to_be_trimmed():
    long = [span("word " * 950, "ch03/s01/m001")]

    assert any(
        "keep a formula under" in p for p in check(mutated(_set("formulas.0.intuition", long)))
    )


# --- Selector ------------------------------------------------------------------------------


def select(session: Session, doc: Document):
    return select_inputs(session, "paper_math", doc, None, media_dir=Path("/media"))


def test_the_input_is_the_notation_input_plus_notation_card_and_shelf_concepts(session):
    paper = add_paper(session)
    symbol = {"symbol_latex": "d_k", "meaning": "Key size.", "first_anchor": "ch02/s01/m001"}
    notation = {"symbols": [{**symbol, "cites": ["ch02/s01/m001"]}]}
    store(session, paper, ArtifactType.NOTATION_TABLE, None, Review.APPROVED, content=notation)
    store(
        session,
        paper,
        ArtifactType.PAPER_CARD,
        None,
        content={"tldr": [span("Attention.", "ch01/p001")]},
    )
    session.add(Concept(canonical="attention", kind=ConceptKind.METHOD))
    session.commit()

    inputs = select(session, paper).inputs

    assert [b["anchor"] for b in inputs["blocks"]] == ["ch02/s01/p001", "ch02/s01/m001"]
    assert inputs["math_descriptions"] == [] and inputs["distilled_formulas"] == []
    assert inputs["notation_table"] == notation["symbols"]
    assert inputs["paper_card"] == {"tldr": [span("Attention.", "ch01/p001")]}
    assert [c["canonical"] for c in inputs["existing_concepts"]] == ["attention"]
    assert inputs["scope"]["anchor"] is None


def test_a_paper_without_formulas_has_no_math_to_explain(session):
    no_math = add_paper(session, nodes=without_elements())

    with pytest.raises(SelectorError, match="no formulas"):
        select(session, no_math)


# --- A run on the fixture paper ----------------------------------------------------------------


def attention_explainer(steps: list[str] | None = None) -> dict[str, Any]:
    """A minimal valid explainer of the fixture paper's one formula."""
    m, p = "ch02/s01/m001", "ch02/s01/p001"
    diagram = {
        "type": "diagram",
        "nodes": [{"id": "a", "label": "Queries"}, {"id": "b", "label": "Answers"}],
        "edges": [{"from": "a", "to": "b"}],
        "cites": [m],
    }
    return {
        "big_picture": {"problem": [span("Look things up by similarity.", p)], "map": diagram},
        "formulas": [{
            "anchor": m, "latex": ATTENTION_LATEX, "name": "The lookup",
            "in_plain_words": [span("Compare, share out, mix.", m)],
            "symbols": [{"symbol": s, "everyday": [span(f"{s} meaning.", p)]}
                        for s in ("Q", "K", "V", "d_k")],
            "intuition": [span("A library lookup.", m)], "diagram": diagram,
            "worked_example": {"setup": [span("Two keys.", m)],
                               "steps": {"type": "steps", "items": [[span(t, m)] for t in
                                         steps or ["1 * 2 + 3 * 4 = 14."]]},
                               "result": [span("A score of 14.", m)]},
            "why_here": [span("It is the model.", p)], "added_value": [span("Parallel.", p)],
            "common_confusion": {"type": "callout", "tone": "caution",
                                 "spans": [span("T is a transpose.", m)]},
            "try_it": {"question": [span("2 * 2?", m)], "answer": [span("2 * 2 = 4.", m)]},
            "explore_further": {"prerequisites": [], "search_terms": ["dot product"],
                                "next_question": [span("Why divide?", m)]},
        }],
        "glossary": [],
        "love_note": {"type": "callout", "tone": "insight", "spans": [span("One line.", m)]},
        "path": [{"title": "The lookup", "formula": m, "minutes": 15, "goal": [span("Do it.", m)]}],
    }  # fmt: skip


def derive(paper: Document) -> JobSpec:
    return JobSpec(kind=JobKind.DERIVE, document_id=paper.id, skill=SKILL)


def test_a_run_stores_a_draft_math_explainer_at_the_distil_tier(session):
    paper = add_paper(session)

    job, runner = run(session, derive(paper), attention_explainer())

    artifact = stored(session, job)
    assert (artifact.type, artifact.anchor, artifact.skill) == (
        ArtifactType.MATH_EXPLAINER,
        None,
        SKILL,
    )
    assert artifact.review is Review.DRAFT, artifact.gates["flags"]
    assert runner.calls[0]["tier"] is Tier.DISTIL


def test_wrong_arithmetic_goes_back_on_the_retry(session):
    paper = add_paper(session)
    job = queue.enqueue(session, derive(paper))
    assert job is not None
    bad, good = attention_explainer(["1 * 2 + 3 * 4 = 15."]), attention_explainer()
    runner = FakeRunner(json.dumps(bad), json.dumps(good))
    execute_skill_job(session, job, runner=runner, skills_dir=SKILLS_DIR, media_dir=Path("/m"))

    assert "1 * 2 + 3 * 4 = 15 is wrong (it is 14)" in str(runner.calls[1]["prompt"])


# --- Rendering and search ----------------------------------------------------------------------


def test_every_cited_span_survives_flattening_and_the_type_is_searchable():
    body = example(SKILL)

    blocks = body_blocks(body)

    kept = {s["text"] for s in leaf_spans(blocks) if s["cites"]}
    assert kept == {s["text"] for s in leaf_spans(body)}
    assert ArtifactType.MATH_EXPLAINER in INDEXED_TYPES
    assert "A squashing machine" in flatten_body(body)


def test_the_markdown_reads_formula_by_formula_with_the_path_and_glossary():
    markdown = render_blocks(body_blocks(example(SKILL)))

    headings = [b["text"] for b in body_blocks(example(SKILL)) if b["type"] == "heading"]
    assert headings == ["The big picture", "The trust score", "Listening in proportion to trust",
                        "Learning path", "Glossary"]  # fmt: skip
    assert "```mermaid" in markdown and "$$" in markdown
    assert "**Try it:**" in markdown and "**The trust score (15 min):**" in markdown

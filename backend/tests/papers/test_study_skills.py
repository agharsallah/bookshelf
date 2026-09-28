"""The study and critique skills (assess-paper, review-paper, make-notation,
make-journal-club): vocabularies, schema shapes, the cross-field gates of
`app.papers.checks`, and real runs on the fixture paper through the generic handler.
"""

import copy
import json
from pathlib import Path
from typing import Any

import pytest
from sqlmodel import Session

from app.jobs import queue
from app.jobs.queue import JobSpec
from app.models import Document
from app.models.enums import (
    ArtifactType,
    AssessmentCriterion,
    JobKind,
    ReproducibilityStatus,
    Review,
    Tier,
)
from app.pipeline import interactive
from app.pipeline.execution import execute_skill_job, prepare
from app.pipeline.runner import FakeRunner, OutputError
from app.pipeline.skills import load_catalogue
from tests.papers.paper_fixtures import add_paper, store
from tests.papers.test_paper_skills import (
    SKILLS_DIR,
    distil_every_unit,
    example,
    run,
    schema_problems,
    skill,
    stored,
)
from tests.pipeline.runtime.conftest import span


@pytest.fixture
def paper(session: Session) -> Document:
    distilled = add_paper(session)
    distil_every_unit(session, distilled)
    return distilled


def derive(paper: Document, name: str) -> JobSpec:
    return JobSpec(kind=JobKind.DERIVE, document_id=paper.id, skill=name)


def retried_with(session: Session, spec: JobSpec, bad: dict, good: dict) -> str:
    """Run `bad` then `good`; the prompt of the retry (which lists the problems)."""
    job = queue.enqueue(session, spec)
    assert job is not None
    runner = FakeRunner(json.dumps(bad), json.dumps(good))
    execute_skill_job(session, job, runner=runner, skills_dir=SKILLS_DIR, media_dir=Path("/m"))
    assert len(runner.calls) == 2
    return str(runner.calls[1]["prompt"])


# --- Vocabularies and shapes --------------------------------------------------------------


def test_the_rubric_and_checklist_statuses_are_the_enums():
    props = skill("assess-paper").schema["properties"]
    criteria = props["scores"]["items"]["properties"]["criterion"]["enum"]
    statuses = props["reproducibility"]["items"]["properties"]["status"]["enum"]
    assert criteria == [c.value for c in AssessmentCriterion]
    assert set(statuses) == set(ReproducibilityStatus)


def test_the_study_skills_are_paper_derives_of_their_types():
    catalogue = load_catalogue(SKILLS_DIR)
    types = {
        "assess-paper": ArtifactType.PAPER_ASSESSMENT,
        "review-paper": ArtifactType.PAPER_REVIEW,
        "make-notation": ArtifactType.NOTATION_TABLE,
        "make-journal-club": ArtifactType.JOURNAL_CLUB,
    }
    assert {name: catalogue[name].meta.artifact_type for name in types} == types


def _duplicate_criterion(out: dict[str, Any]) -> None:
    out["scores"][0]["criterion"] = "rigour"


def _score_out_of_range(out: dict[str, Any]) -> None:
    out["scores"][0]["score"] = 6


def _checklist_item_missing(out: dict[str, Any]) -> None:
    out["reproducibility"].pop()


def _unknown_status(out: dict[str, Any]) -> None:
    out["reproducibility"][0]["status"] = "maybe"


def _unknown_recommendation(out: dict[str, Any]) -> None:
    out["verdict"]["recommendation"] = "major_revision"


def _confidence_zero(out: dict[str, Any]) -> None:
    out["verdict"]["confidence"] = 0


def _weakness_without_severity(out: dict[str, Any]) -> None:
    del out["weaknesses"][0]["severity"]


def _symbol_without_first_anchor(out: dict[str, Any]) -> None:
    del out["symbols"][0]["first_anchor"]


def _symbol_uncited(out: dict[str, Any]) -> None:
    out["symbols"][0]["cites"] = []


def _four_questions(out: dict[str, Any]) -> None:
    out["questions"].pop()


def _figure_as_text(out: dict[str, Any]) -> None:
    out["key_figure"] = "Figure 1"


def _one_sided_debate(out: dict[str, Any]) -> None:
    out["debate"]["against"] = []


BROKEN = [
    ("assess-paper", _duplicate_criterion),
    ("assess-paper", _score_out_of_range),
    ("assess-paper", _checklist_item_missing),
    ("assess-paper", _unknown_status),
    ("review-paper", _unknown_recommendation),
    ("review-paper", _confidence_zero),
    ("review-paper", _weakness_without_severity),
    ("make-notation", _symbol_without_first_anchor),
    ("make-notation", _symbol_uncited),
    ("make-journal-club", _four_questions),
    ("make-journal-club", _figure_as_text),
    ("make-journal-club", _one_sided_debate),
]


@pytest.mark.parametrize(("name", "mutate"), BROKEN, ids=[f"{n}-{m.__name__}" for n, m in BROKEN])
def test_each_study_schema_enforces_its_shape(name, mutate):
    output = copy.deepcopy(example(name))
    assert schema_problems(name, output) == []

    mutate(output)

    assert schema_problems(name, output) != []


# --- Outputs for the fixture paper ---------------------------------------------------------

CRITERIA = [c.value for c in AssessmentCriterion]
ITEMS = skill("assess-paper").schema["properties"]["reproducibility"]["items"]["properties"][
    "item"
]["enum"]


def assessment(**changes: Any) -> dict[str, Any]:
    out = {
        "overall": [span("Clear and well supported on one language pair.", "ch03/p001")],
        "scores": [{"criterion": c, "score": 3, "spans": [span(f"{c} reason.", "ch02/p001")]}
                   for c in CRITERIA],
        "reproducibility": [{"item": i, "status": "unknown",
                             "spans": [span("Not stated in the setup.", "ch03/p001")]}
                            for i in ITEMS],
        "related_shelf": [],
    }  # fmt: skip
    return {**out, **changes}


def review(**changes: Any) -> dict[str, Any]:
    out = {
        "summary": [span("An attention-only translation model.", "ch02/p001")],
        "strengths": [[span("Parallel training.", "ch01/p002")]],
        "weaknesses": [{"severity": "major", "spans": [span("One language pair.", "ch03/p001")]}],
        "questions": [],
        "missing_experiments": [[span("Variance over seeds.", "ch03/t001")]],
        "verdict": {"recommendation": "accept", "confidence": 3,
                    "spans": [span("Strong results.", "ch03/t001")]},
    }  # fmt: skip
    return {**out, **changes}


def symbol(latex: str, first: str, *cites: str) -> dict[str, Any]:
    return {"symbol_latex": latex, "meaning": f"{latex} meaning.", "first_anchor": first,
            "cites": list(cites or (first,))}  # fmt: skip


def notation(*symbols: dict[str, Any]) -> dict[str, Any]:
    return {"symbols": list(symbols) or [symbol("Q", "ch02/s01/p001", "ch02/s01/m001"),
                                         symbol("d_k", "ch02/s01/m001")]}  # fmt: skip


def journal_club(key_figure: Any = "ch02/s01/f001") -> dict[str, Any]:
    figure = (
        {"anchor": key_figure, "why": [span("The attention function.", key_figure)]}
        if key_figure
        else None
    )
    return {
        "pitch": [span("Drop recurrence entirely.", "ch01/p002")],
        "key_figure": figure,
        "weakest_assumption": {"spans": [span("One language pair generalises.", "ch03/p001")]},
        "questions": [[span(f"Question {i}?", "ch02/p001")] for i in range(5)],
        "debate": {"for": [[span("28.4 BLEU.", "ch03/t001")], [span("Parallel.", "ch01/p002")]],
                   "against": [[span("One pair.", "ch03/p001")],
                               [span("No variance.", "ch03/t001")]]},
    }  # fmt: skip


RUNS = [
    ("assess-paper", assessment, ArtifactType.PAPER_ASSESSMENT, Tier.REASON),
    ("review-paper", review, ArtifactType.PAPER_REVIEW, Tier.REASON),
    ("make-notation", notation, ArtifactType.NOTATION_TABLE, Tier.EXPLORE),
    ("make-journal-club", journal_club, ArtifactType.JOURNAL_CLUB, Tier.DISTIL),
]


@pytest.mark.parametrize(("name", "output", "kind", "tier"), RUNS, ids=[r[0] for r in RUNS])
def test_each_study_skill_stores_its_document_artifact(session, paper, name, output, kind, tier):
    job, runner = run(session, derive(paper, name), output())

    artifact = stored(session, job)
    assert (artifact.type, artifact.anchor, artifact.skill) == (kind, None, name)
    assert artifact.review is Review.DRAFT, artifact.gates["flags"]
    assert runner.calls[0]["tier"] is tier
    assert "interactive:start" not in runner.calls[0]["prompt"]


def test_an_assessment_names_the_shelf_it_is_relevant_to(session, paper):
    other = add_paper(session, slug="devlin-bert")
    store(session, other, ArtifactType.PAPER_CARD, None,
          content={"tldr": [span("Pre-train, then tune.", "ch01/p001")]})  # fmt: skip
    related = [{"slug": "devlin-bert", "why": [span("Both use attention.", "ch02/p001")]}]

    job, runner = run(session, derive(paper, "assess-paper"), assessment(related_shelf=related))

    assert '"tldr": "Pre-train, then tune."' in runner.calls[0]["prompt"]
    assert stored(session, job).body["related_shelf"][0]["slug"] == "devlin-bert"


# --- Cross-field gates (app.papers.checks), sent back on the retry -------------------------


def test_an_assessment_with_an_uncited_score_or_an_unknown_shelf_paper_is_retried(session, paper):
    bad = assessment(related_shelf=[{"slug": "nobody-2020", "why": [span("x", "ch02/p001")]}])
    bad["scores"][2]["spans"] = [{"text": "Convincing.", "cites": []}]

    prompt = retried_with(session, derive(paper, "assess-paper"), bad, assessment())

    assert "scores: evidence cites nothing" in prompt
    assert "'nobody-2020' is not a slug in inputs.shelf.papers" in prompt


def test_an_uncited_verdict_is_retried(session, paper):
    bad = review()
    bad["verdict"]["spans"] = [{"text": "Accept.", "cites": []}]

    prompt = retried_with(session, derive(paper, "review-paper"), bad, review())

    assert "verdict: the recommendation cites nothing" in prompt


@pytest.mark.parametrize(
    ("symbols", "problem"),
    [
        ([symbol("d_k", "ch02/s01/m001"), symbol("d_{k}", "ch02/s01/m001")],
         "'d_{k}' repeats 'd_k'"),
        ([symbol("Q", "ch02/s01/m001", "ch02/s01/p001")],
         "'Q' is cited at ch02/s01/p001 before its first_anchor ch02/s01/m001"),
        ([symbol("Q", "ch03/p001")], "first_anchor ch03/p001 is not in inputs.blocks"),
        ([symbol("Q", "ch02/s01/p001", "ch02/s01/m001", "ch02/p001")],
         "cites blocks not in inputs.blocks: ['ch02/p001']"),
    ],
    ids=["duplicate", "cited-before-first-use", "first-anchor-not-offered", "cite-not-offered"],
)  # fmt: skip
def test_a_notation_table_is_checked_for_duplicates_and_first_use(session, paper, symbols,
                                                                  problem):  # fmt: skip
    prompt = retried_with(session, derive(paper, "make-notation"), notation(*symbols), notation())

    assert problem in prompt


@pytest.mark.parametrize(
    ("key_figure", "problem"),
    [("ch03/t001", "key_figure: ch03/t001 is not a figure; pick one of: ch02/s01/f001"),
     (None, "key_figure: pick one of inputs.figures")],
)  # fmt: skip
def test_the_key_figure_must_be_one_of_the_papers_figures(session, paper, key_figure, problem):
    bad = journal_club(key_figure)

    prompt = retried_with(session, derive(paper, "make-journal-club"), bad, journal_club())

    assert problem in prompt


def test_the_interactive_import_runs_the_same_cross_field_gates(session, paper):
    package = load_catalogue(SKILLS_DIR)["make-notation"]
    prepared = prepare(session, package, paper, None)
    duplicated = notation(symbol("d_k", "ch02/s01/m001"), symbol("d_k", "ch02/s01/m001"))

    with pytest.raises(OutputError, match="repeats"):
        interactive.import_output(
            session, skill="make-notation", document=paper.slug, anchor=None,
            input_hash=prepared.input_hash, output=duplicated, skills_dir=SKILLS_DIR,
        )  # fmt: skip

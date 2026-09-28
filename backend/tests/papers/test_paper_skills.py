"""The core paper skills (skills/distil-paper-section, dissect-paper, simplify-paper), run
through the real packages and the generic handler with a FakeRunner.

The catalogue test (tests/test_skills_catalog.py) already checks each package's contract and
that its example validates; here: the vocabularies match the enums, each schema enforces
its shape, and a realistic output for the fixture paper is stored with the right type,
anchor, variant and gates.
"""

import copy
import json
from pathlib import Path
from typing import Any

import pytest
from sqlmodel import Session

from app.core.config import get_settings
from app.jobs import queue
from app.jobs.queue import JobSpec
from app.models import Artifact, Document, Job
from app.models.enums import (
    ArtifactType,
    ClaimKind,
    ExplainerLevel,
    Genre,
    JobKind,
    JobState,
    Tier,
)
from app.pipeline import authoring, gates
from app.pipeline.execution import execute_skill_job
from app.pipeline.runner import FakeRunner, OutputError
from app.pipeline.skills import Skill, load_catalogue
from tests.papers.paper_fixtures import ATTENTION_LATEX, UNITS, add_paper, store
from tests.pipeline.runtime.conftest import body, paragraph, span

SKILLS_DIR = get_settings().skills_dir


def skill(name: str) -> Skill:
    return load_catalogue(SKILLS_DIR)[name]


def example(name: str) -> dict[str, Any]:
    return json.loads((SKILLS_DIR / name / "example.json").read_text())


def schema_problems(name: str, output: dict[str, Any]) -> list[str]:
    return gates.schema_errors(skill(name).schema, output)


def run(session: Session, spec: JobSpec, reply: dict[str, Any]) -> tuple[Job, FakeRunner]:
    job = queue.enqueue(session, spec)
    assert job is not None
    runner = FakeRunner(json.dumps(reply))
    outcome = execute_skill_job(
        session, job, runner=runner, skills_dir=SKILLS_DIR, media_dir=Path("/media")
    )
    assert outcome.state is JobState.DONE, outcome.result
    job.result = outcome.result
    return job, runner


def stored(session: Session, job: Job) -> Artifact:
    artifact = session.get(Artifact, job.result["artifact_id"])
    assert artifact is not None
    return artifact


@pytest.fixture
def paper(session: Session) -> Document:
    return add_paper(session)


# --- Vocabularies and shapes --------------------------------------------------------------


def test_contribution_kinds_are_the_claim_kinds():
    props = skill("dissect-paper").schema["properties"]
    kinds = props["contributions"]["items"]["properties"]["kind"]["enum"]
    assert set(kinds) == set(ClaimKind)


def test_explainer_levels_are_the_enum_and_practitioner_is_the_default():
    spec = skill("simplify-paper").meta.params["level"]
    assert set(spec.choices) == set(ExplainerLevel)
    assert spec.default == ExplainerLevel.PRACTITIONER
    assert skill("simplify-paper").meta.variant_of({"level": "expert"}) == "expert"


def _drop_setup(out: dict[str, Any]) -> None:
    del out["setup"]


def _unknown_contribution_kind(out: dict[str, Any]) -> None:
    out["contributions"][0]["kind"] = "novelty"


def _prose_number(out: dict[str, Any]) -> None:
    out["numbers"][0]["value"] = "about two points of exact match"


def _no_results(out: dict[str, Any]) -> None:
    out["results"] = []


def _diagram_in_results(out: dict[str, Any]) -> None:
    out["results"].append(out["method"][1])


def _limitation_as_text(out: dict[str, Any]) -> None:
    out["limitations"]["stated"] = ["The gate is trained per benchmark."]


def _equation_without_cites(out: dict[str, Any]) -> None:
    out["equations"][0]["cites"] = []


def _analogy_as_text(out: dict[str, Any]) -> None:
    out["analogy"] = "Like an editor."


def _prerequisite_without_shelf_key(out: dict[str, Any]) -> None:
    del out["prerequisites"][0]["shelf_concept"]


def _table_cell_without_cites(out: dict[str, Any]) -> None:
    table = next(b for b in out["blocks"] if b["type"] == "table")
    table["rows"][0][0] = {"text": "Reader encoder"}


BROKEN = [
    ("dissect-paper", _drop_setup),
    ("dissect-paper", _unknown_contribution_kind),
    ("dissect-paper", _prose_number),
    ("dissect-paper", _no_results),
    ("dissect-paper", _diagram_in_results),
    ("dissect-paper", _limitation_as_text),
    ("simplify-paper", _equation_without_cites),
    ("simplify-paper", _analogy_as_text),
    ("simplify-paper", _prerequisite_without_shelf_key),
    ("distil-paper-section", _table_cell_without_cites),
]


@pytest.mark.parametrize(("name", "mutate"), BROKEN, ids=[f"{n}-{m.__name__}" for n, m in BROKEN])
def test_each_paper_schema_enforces_its_shape(name, mutate):
    output = copy.deepcopy(example(name))
    assert schema_problems(name, output) == []

    mutate(output)

    assert schema_problems(name, output) != []


def test_an_expert_explainer_may_skip_the_analogy():
    output = {**example("simplify-paper"), "analogy": None}
    assert schema_problems("simplify-paper", output) == []


# --- Real runs on the fixture paper ---------------------------------------------------------

RESULTS_NOTE = body(
    {"type": "callout", "tone": "important", "spans": [
        span("The big model reaches 28.4 BLEU on English-German.", "ch03/p001")]},
    {"type": "table", "header": ["Model", "BLEU"], "rows": [
        [span("Big", "ch03/t001"), span("28.4", "ch03/t001")]]},
)  # fmt: skip


def test_a_unit_distillation_is_stored_as_the_units_chapter_distillation(session, paper):
    spec = JobSpec(kind=JobKind.DISTIL_PAPER_SECTION, document_id=paper.id, anchor="ch03")

    job, runner = run(session, spec, RESULTS_NOTE)

    artifact = stored(session, job)
    assert (artifact.type, artifact.anchor, artifact.skill) == (
        ArtifactType.CHAPTER_DISTILLATION, "ch03", "distil-paper-section"
    )  # fmt: skip
    assert artifact.gates["grounding"] == 1.0
    assert artifact.gates["compression"] is not None
    assert runner.calls[0]["tier"] is Tier.DISTIL
    prompt = runner.calls[0]["prompt"]
    assert "# Distil a paper section" in prompt
    assert '"role": "results"' in prompt
    assert "interactive:start" not in prompt


def test_a_unit_note_citing_the_abstract_is_flagged_out_of_scope(session, paper):
    leaked = body(paragraph("A model based solely on attention.", "fm01/p001"))
    spec = JobSpec(kind=JobKind.DISTIL_PAPER_SECTION, document_id=paper.id, anchor="ch03")

    job, _ = run(session, spec, leaked)

    assert "out_of_scope_cites" in stored(session, job).gates["flags"]


def card() -> dict[str, Any]:
    return {
        "tldr": [span("An attention-only translation model reaches 28.4 BLEU.", "fm01/p001",
                      "ch03/p001")],
        "question": [span("Can translation drop recurrence?", "ch01/p002")],
        "contributions": [{"kind": "method", "spans": [span("Scaled dot-product attention.",
                                                            "ch02/s01/p001")]}],
        "method": [{"type": "math", "latex": ATTENTION_LATEX, "cites": ["ch02/s01/m001"],
                    "meaning": [span("Softmax of scaled query-key scores weights values.",
                                     "ch02/s01/m001")]}],
        "setup": {"datasets": [{"name": "WMT 2014 English-German",
                                "spans": [span("Translation benchmark.", "ch03/p001")]}],
                  "baselines": [], "metrics": [{"name": "BLEU", "spans": [span("Reported.",
                                                                                 "ch03/t001")]}]},
        "results": [{"type": "table", "header": ["Model", "BLEU"],
                     "rows": [[span("Big", "ch03/t001"), span("28.4", "ch03/t001")]]}],
        "limitations": {"stated": [], "unstated": [[span("One language pair reported here.",
                                                         "ch03/p001")]]},
        "assumptions": [],
        "future_work": [],
        "numbers": [{"value": "28.4 BLEU", "label": [span("English-German, big model",
                                                          "ch03/t001")]}],
    }  # fmt: skip


def distil_every_unit(session: Session, paper: Document) -> None:
    for unit in UNITS:
        store(session, paper, ArtifactType.CHAPTER_DISTILLATION, unit,
              content=body(paragraph(f"{unit} distilled", f"{unit}/p001")))  # fmt: skip


def test_the_card_is_a_paper_card_covering_every_unit(session, paper):
    distil_every_unit(session, paper)

    job, runner = run(session, JobSpec(kind=JobKind.DISSECT_PAPER, document_id=paper.id), card())

    artifact = stored(session, job)
    assert (artifact.type, artifact.anchor, artifact.skill) == (
        ArtifactType.PAPER_CARD, None, "dissect-paper"
    )  # fmt: skip
    assert artifact.gates["coverage"] == 1.0
    assert artifact.gates["flags"] == []
    assert runner.calls[0]["tier"] is Tier.REASON


def test_a_card_citing_an_invented_anchor_is_retried_with_the_problem(session, paper):
    distil_every_unit(session, paper)
    bad = card()
    bad["tldr"] = [span("Invented.", "ch09/p001")]
    job = queue.enqueue(session, JobSpec(kind=JobKind.DISSECT_PAPER, document_id=paper.id))
    assert job is not None
    runner = FakeRunner(json.dumps(bad), json.dumps(card()))

    execute_skill_job(session, job, runner=runner, skills_dir=SKILLS_DIR, media_dir=Path("/m"))

    assert "ch09/p001" in runner.calls[1]["prompt"]


def explainer() -> dict[str, Any]:
    return {
        "prerequisites": [{"concept": "Softmax", "shelf_concept": None,
                           "why": [span("Attention weights come from a softmax.",
                                        "ch02/s01/m001")]}],
        "intuition": [paragraph("Every word looks at every other word at once.",
                                "ch02/s01/p001")],
        "walkthrough": [paragraph("The encoder maps symbols to representations.", "ch02/p001"),
                        paragraph("The big model reaches 28.4 BLEU.", "ch03/p001")],
        "analogy": [span("Like a room where everyone hears everyone.", "ch02/s01/p001")],
        "equations": [{"latex": ATTENTION_LATEX, "cites": ["ch02/s01/m001"],
                       "plain": [span("Scores become weights over values.", "ch02/s01/m001")]}],
    }  # fmt: skip


def test_an_explainer_is_stored_under_its_level(session, paper):
    distil_every_unit(session, paper)
    spec = JobSpec(kind=JobKind.DERIVE, document_id=paper.id, skill="simplify-paper",
                   payload={"params": {"level": "newcomer"}})  # fmt: skip

    job, runner = run(session, spec, explainer())

    artifact = stored(session, job)
    assert (artifact.type, artifact.variant) == (ArtifactType.PAPER_EXPLAINER, "newcomer")
    assert '"level": "newcomer"' in runner.calls[0]["prompt"]


# --- Human edits pick the paper skill's schema ---------------------------------------------


def test_a_papers_chapter_distillation_is_checked_against_the_paper_skill(session, paper):
    kind = ArtifactType.CHAPTER_DISTILLATION
    paper_schema = authoring.schema_for_type(kind, SKILLS_DIR, genre=Genre.PAPER)
    book_schema = authoring.schema_for_type(kind, SKILLS_DIR, genre=Genre.BOOK)

    assert paper_schema["$id"].endswith("/distil-paper-section/schema.json")
    assert book_schema["$id"].endswith("/distil-chapter/schema.json")
    assert authoring.schema_for_type(kind, SKILLS_DIR)["$id"] == book_schema["$id"]


def test_a_human_card_passes_the_hard_gates_of_the_card_schema(session, paper):
    record = authoring.check_human_body(
        session, paper.id, ArtifactType.PAPER_CARD, card(), skills_dir=SKILLS_DIR
    )
    assert record["flags"] == []

    with pytest.raises(OutputError, match="setup"):
        broken = card()
        del broken["setup"]
        authoring.check_human_body(
            session, paper.id, ArtifactType.PAPER_CARD, broken, skills_dir=SKILLS_DIR
        )

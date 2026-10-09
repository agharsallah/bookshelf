"""make-pills: its package, its input (`chapter_pills`), its gates and its checks, and a
batch run end to end (a fake CLI) whose pill_set is harvested into threaded pills."""

import copy
import json
from pathlib import Path
from typing import Any

import pytest
from jsonschema import Draft202012Validator
from sqlmodel import Session, select

from app.core.config import REPO_ROOT
from app.jobs import queue
from app.jobs.queue import JobSpec
from app.models import Artifact, Document
from app.models.enums import ArtifactType, JobKind, JobState, PillKind
from app.models.pill import Pill
from app.pills import checks
from app.pills.store import sync_document
from app.pipeline import gates
from app.pipeline.execution import execute_skill_job
from app.pipeline.runner import FakeRunner
from app.pipeline.selectors import Selection, SelectorError, select_inputs
from app.pipeline.skills import GateConfig, load_skill
from tests.api.factories import make_artifact
from tests.pills.fixtures import example

SKILL_DIR = REPO_ROOT / "skills" / "make-pills"


def cited(text: str, anchor: str = "ch03/s01/p004") -> list[dict[str, Any]]:
    return [{"text": text, "cites": [anchor]}]


def pill(kind: str, headline: str, body: dict[str, Any], anchor: str = "ch03/s01/p004"):
    return {"kind": kind, "headline": headline, "body": body, "cites": [anchor]}


def selection(harvested: list[dict[str, str]] | None = None) -> Selection:
    return Selection(
        inputs={"harvested": harvested or []}, source_words=0, valid_anchors=frozenset()
    )


# --- The package --------------------------------------------------------------------------


def test_the_package_loads_with_its_params_and_new_gate():
    skill = load_skill(SKILL_DIR)

    assert (skill.meta.artifact_type, skill.meta.selector) == (
        ArtifactType.PILL_SET,
        "chapter_pills",
    )
    assert skill.meta.gates.pill_words == (8, 60)
    assert skill.meta.variant_of(skill.meta.resolve_params({"style": "story"})) == "story"
    assert skill.meta.variant_of(skill.meta.resolve_params(None)) == "plain"


def test_the_schema_holds_bodies_to_their_kind():
    skill = load_skill(SKILL_DIR)
    validator = Draft202012Validator(skill.schema, registry=gates.contracts_registry())
    good = example("make-pills")
    assert list(validator.iter_errors(good)) == []

    flip_as_hook = copy.deepcopy(good)
    flip_as_hook["threads"][0]["pills"][0]["kind"] = "flip"
    two_pill_thread = copy.deepcopy(good)
    two_pill_thread["threads"][0]["pills"] = two_pill_thread["threads"][0]["pills"][:2]
    uncited = copy.deepcopy(good)
    uncited["pills"][0]["body"]["spans"][0]["cites"] = []
    for broken in (flip_as_hook, two_pill_thread, uncited):
        assert not validator.is_valid(broken)


# --- Gates and checks ---------------------------------------------------------------------


def test_pill_words_flag_pills_outside_the_band():
    short = pill("remember", "Too short", {"spans": cited("Slack helps.")})
    long = pill("remember", "Too long", {"spans": cited(" ".join(["word"] * 70))})
    config = GateConfig(grounding_min=0, pill_words=(8, 60))

    def flags(*pills: dict[str, Any]) -> list[str]:
        output = {"threads": [], "pills": list(pills)}
        return gates.evaluate(output, config=config, valid_anchors=[], source_words=0).flags

    assert flags(*example("make-pills")["pills"]) == []
    assert flags(short) == ["pill_too_short"]
    assert flags(short, long) == ["pill_too_short", "pill_too_long"]
    assert gates.pill_word_counts({"pills": [short]}) == [2]


def test_the_example_passes_its_checks():
    assert checks.check_pill_set(example("make-pills"), selection()) == []


def test_a_quiz_answer_must_index_a_choice():
    output = example("make-pills")
    output["threads"][0]["pills"][2]["body"]["answer"] = 3

    (problem,) = checks.check_pill_set(output, selection())

    assert problem.startswith("threads[0].pills[2]: answer 3 is not an index of its 3 choices")


def test_a_thread_outside_three_to_six_pills_is_refused():
    output = example("make-pills")
    output["threads"][0]["pills"] = output["threads"][0]["pills"][:2]

    assert checks.check_pill_set(output, selection()) == ["threads[0]: 2 pills; a thread holds 3-6"]


def test_near_duplicates_of_harvested_pills_are_refused():
    output = example("make-pills")
    harvested = [
        {"kind": "definition", "text": "Slack is not waste!", "key": "a"},  # a headline
        {  # the opening words of a harvested flip, reworded only in case and punctuation
            "kind": "flip",
            "text": "kingman's formula -- queue time is a product of which three terms …",
            "key": "b",
        },
        {"kind": "insight", "text": "An unrelated idea about batch sizes and flow", "key": "c"},
    ]

    problems = checks.check_pill_set(output, selection(harvested))

    assert [p.split(":")[0] for p in problems] == ["threads[0].pills[3]", "pills[1]"]
    assert "restates the harvested pill 'Slack is not waste!'" in problems[0]


def test_a_pill_repeating_another_of_the_output_is_refused():
    output = example("make-pills")
    output["pills"].append(copy.deepcopy(output["threads"][0]["pills"][1]))

    assert checks.check_pill_set(output, selection()) == [
        "pills[2]: repeats threads[0].pills[1]; keep one"
    ]


# --- The selector -------------------------------------------------------------------------


DISTILLATION = {
    "blocks": [
        {
            "type": "callout",
            "tone": "important",
            "spans": cited("Past 80% utilization every extra percent costs a lot of waiting."),
        },
        {"type": "paragraph", "spans": cited("Slack keeps a queue short.", "ch03/p001")},
    ]
}


def harvested_pill(session: Session, book: Document, **fields: Any) -> Pill:
    values: dict[str, Any] = {
        "document_id": book.id,
        "anchor": "ch03",
        "kind": PillKind.REMEMBER,
        "body": {
            "spans": cited(
                "Keep a fifth of capacity free for the unexpected work that always arrives late."
            )
        },
        "est_seconds": 10,
        "origin": "harvest:chapter_distillation",
        "source_key": "f" * 64,
    }
    row = Pill(**(values | fields))
    session.add(row)
    session.commit()
    return row


def test_chapter_pills_reads_the_distillation_marks_and_harvested_pills(session, book):
    make_artifact(
        session, book, type=ArtifactType.CHAPTER_DISTILLATION, anchor="ch03", body=DISTILLATION
    )
    marks = [
        {"tier": "core", "text": "Slack is not waste.", "cites": ["ch03/p001"], "why": "thesis"},
        {"tier": "term", "text": "slack", "cites": ["ch03/p001"], "why": "a term"},
    ]
    make_artifact(
        session, book, type=ArtifactType.SALIENCE_MARKS, anchor="ch03", body={"marks": marks}
    )
    harvested_pill(session, book)
    harvested_pill(session, book, headline="Little's law", source_key="a" * 64)
    harvested_pill(session, book, origin="skill:make-pills@1", source_key="b" * 64)
    harvested_pill(session, book, anchor="ch04", source_key="c" * 64)

    inputs = select_inputs(session, "chapter_pills", book, "ch03").inputs

    assert (inputs["document"]["title"], inputs["scope"]["anchor"]) == (book.title, "ch03")
    assert inputs["distillation"] == DISTILLATION
    assert inputs["salience"] == [
        {"tier": "core", "text": "Slack is not waste.", "cites": ["ch03/p001"]}
    ]
    opening = "Keep a fifth of capacity free for the unexpected work that always …"
    assert inputs["harvested"] == [
        {"kind": "remember", "text": opening, "key": "f" * 12},
        {"kind": "remember", "text": "Little's law", "key": "a" * 12},
    ]


def test_chapter_pills_needs_a_distillation(session, book):
    with pytest.raises(SelectorError, match="no chapter distillation"):
        select_inputs(session, "chapter_pills", book, "ch03")


# --- A batch run, harvested ---------------------------------------------------------------


def test_a_batch_run_stores_a_pill_set_that_harvests_into_threaded_pills(session, book):
    make_artifact(
        session, book, type=ArtifactType.CHAPTER_DISTILLATION, anchor="ch03", body=DISTILLATION
    )
    output = example("make-pills")
    raw = json.dumps(output)
    for anchor in ("ch03/s01/p001", "ch03/s02/p003", "ch03/s02/p005", "ch03/s03/p001"):
        raw = raw.replace(f'"{anchor}"', '"ch03/p001"')
    output = json.loads(raw.replace('"ch03/p001", "ch03/p001"', '"ch03/p001"'))
    job = queue.enqueue(
        session,
        JobSpec(
            kind=JobKind.DERIVE,
            document_id=book.id,
            anchor="ch03",
            skill="make-pills",
            payload={"params": {"style": "story"}},
        ),
    )
    assert job is not None

    outcome = execute_skill_job(
        session, job, runner=FakeRunner(json.dumps(output)), media_dir=Path("/media")
    )

    assert outcome.state is JobState.DONE, outcome.result
    stored = session.exec(select(Artifact).where(Artifact.type == ArtifactType.PILL_SET)).one()
    assert (stored.anchor, stored.variant, stored.gates["flags"]) == ("ch03", "story", [])
    sync_document(session, book)
    pills = session.exec(
        select(Pill).where(Pill.origin == "skill:make-pills@1").order_by(Pill.thread_index)
    ).all()
    threaded = [p for p in pills if p.thread_key is not None]
    assert [p.kind for p in threaded] == ["hook", "insight", "quiz", "remember"]
    assert [p.thread_index for p in threaded] == [0, 1, 2, 3]
    assert {p.thread_title for p in threaded} == {"Why the busiest team is the slowest"}
    assert len(pills) == 6
    assert all(p.anchor == "ch03" and p.source_artifact_id == stored.id for p in pills)

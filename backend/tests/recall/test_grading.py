"""grade-recall: every verdict cites its idea's passages, and the gaps come back for review."""

import json
import uuid
from datetime import timedelta

import pytest
from sqlmodel import Session, select

from app.jobs.registry import PermanentJobError
from app.models import Document, Job, RecallGrade, ReviewItem
from app.models._columns import utcnow
from app.models.enums import ArtifactType, JobKind, RecallKind, ReviewSource
from app.pipeline.runner import FakeRunner
from app.pipeline.skills import Skill
from app.recall import grading
from app.recall.ideas import key_ideas
from app.services import recalls
from tests.api.factories import make_artifact, make_book
from tests.recall.conftest import grade


def write(session: Session, book: Document, raw: str = "I remember p001.", **kw):
    kind = kw.pop("kind", RecallKind.RECALL)
    recall, _ = recalls.create_recall(session, book, kw.pop("unit", "ch01"), kind, raw)
    return recall


def test_key_ideas_are_the_core_and_key_marks_in_reading_order(session: Session, book):
    ideas = key_ideas(session, book.id, "ch01")

    assert [(i.id, i.tier, i.cites) for i in ideas] == [
        ("I1", "core", ["ch01/s01/p001"]),
        ("I2", "key", ["ch01/s01/p002"]),
    ]


def test_without_marks_the_distillation_supplies_the_ideas(session: Session):
    book = make_book(session)
    body = {
        "blocks": [
            {
                "type": "paragraph",
                "spans": [
                    {
                        "text": "Slack is capacity held in reserve for surprises.",
                        "cites": ["ch01/s01/p001"],
                    },
                    {"text": "So,", "cites": ["ch01/s01/p001"]},
                ],
            }
        ]
    }
    make_artifact(session, book, type=ArtifactType.CHAPTER_DISTILLATION, anchor="ch01", body=body)

    ideas = key_ideas(session, book.id, "ch01")

    assert [(i.text, i.cites) for i in ideas] == [
        ("Slack is capacity held in reserve for surprises.", ["ch01/s01/p001"])
    ]


def test_a_grade_cites_each_idea_and_queues_its_gaps(session: Session, book, skill: Skill):
    recall = write(session, book)
    runner = FakeRunner(grade({"I1": "recalled", "I2": "missed"}))

    stored, _ = grading.grade_recall(session, recall, runner=runner, skill=skill)

    assert [(i["id"], i["status"], i["cites"]) for i in stored.ideas] == [
        ("I1", "recalled", ["ch01/s01/p001"]),
        ("I2", "missed", ["ch01/s01/p002"]),
    ]
    assert stored.question == {
        "idea": "I1",
        "text": "Why is that true, given the text?",
        "cites": ["ch01/s01/p001"],
    }
    assert stored.origin == "skill:grade-recall@1"
    prompt = runner.calls[0]["prompt"]
    shown = prompt.split("## Input", 1)[1]
    assert "I remember p001." in shown and '"cites"' not in shown  # the model grades by id
    items = {i.source: i for i in session.exec(select(ReviewItem)).all()}
    gap, why = items[ReviewSource.RECALL], items[ReviewSource.QUESTION]
    assert (gap.prompt, gap.anchor) == ("What does I2 say about text?", "ch01/s01/p002")
    assert gap.answer == [{"text": "Text of ch01/s01/p002.", "cites": ["ch01/s01/p002"]}]
    assert gap.due > utcnow() + timedelta(hours=23)  # tomorrow: you have just seen it
    assert why.due <= utcnow()  # the why question is for now


def test_missing_the_same_idea_twice_keeps_one_review(session: Session, book, skill: Skill):
    runner = FakeRunner(grade({"I1": "missed", "I2": "missed"}, question=None))
    for raw in ("First try.", "Second try."):
        grading.grade_recall(session, write(session, book, raw), runner=runner, skill=skill)

    gaps = session.exec(select(ReviewItem).where(ReviewItem.source == ReviewSource.RECALL)).all()
    assert len(gaps) == 2
    assert len(session.exec(select(RecallGrade)).all()) == 2


def test_the_prediction_is_set_against_the_thesis(session: Session, book, skill: Skill):
    prediction = write(session, book, "It argues nothing much.", kind=RecallKind.PREDICTION)
    recall = write(session, book)
    comparison = {"predicted": "nothing much", "argues": "p001 matters", "ideas": ["I1"]}
    runner = FakeRunner(grade({"I1": "recalled", "I2": "recalled"}, comparison=comparison))

    stored, _ = grading.grade_recall(session, recall, runner=runner, skill=skill)

    assert stored.prediction_id == prediction.id
    assert stored.comparison == {**comparison, "cites": ["ch01/s01/p001"]}
    assert "It argues nothing much." in runner.calls[0]["prompt"]


@pytest.mark.parametrize(
    "bad",
    [
        grade({"I1": "recalled"}),  # I2 never graded
        grade({"I1": "recalled", "I2": "missed"}, question="I2"),  # question about a gap
        grade(
            {"I1": "recalled", "I2": "missed"},
            comparison={  # no prediction to compare
                "predicted": "x",
                "argues": "y",
                "ideas": ["I1"],
            },
        ),
    ],
)
def test_an_unusable_grade_is_asked_for_again(session: Session, book, skill: Skill, bad: str):
    runner = FakeRunner(bad, grade({"I1": "recalled", "I2": "missed"}))

    stored, _ = grading.grade_recall(session, write(session, book), runner=runner, skill=skill)

    assert len(runner.calls) == 2
    assert [i["status"] for i in stored.ideas] == ["recalled", "missed"]


def test_the_job_grades_the_recall_it_names(session: Session, book, skill: Skill):
    recall = write(session, book)
    job = session.exec(select(Job).where(Job.kind == JobKind.GRADE_RECALL)).one()
    runner = FakeRunner(grade({"I1": "partial", "I2": "recalled"}, question="I2"))

    result = grading.run_grade_job(session, job, runner=runner)

    assert result.result == {"recall_id": str(recall.id), "recalled": 1, "partial": 1, "missed": 0}
    assert session.get(RecallGrade, recall.id) is not None


def test_a_job_for_a_missing_recall_fails_for_good(session: Session, book):
    job = Job(kind=JobKind.GRADE_RECALL, payload={"recall_id": str(uuid.uuid4())})
    with pytest.raises(PermanentJobError):
        grading.run_grade_job(session, job, runner=FakeRunner(json.dumps({})))

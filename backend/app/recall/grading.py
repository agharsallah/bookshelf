"""Grade a recall with the `grade-recall` utility skill, and queue what it missed for review.

    recall (your words) + the chapter's key ideas (I1, I2…) + the prediction, if you wrote one
      → grade-recall (tier `distil`) through the `ModelRunner`, validated: every idea once,
        the "why" question about a recalled idea, a comparison exactly when there is a prediction
      → a `recall_grades` row (replacing an earlier grade), each verdict carrying its idea's cites
      → review items: each partial or missed idea, prompted by its cue, due tomorrow; the "why"
        question, due now

A gap is keyed by the idea itself (its passage and text), so missing the same idea in two
recalls keeps one review item and its schedule.
"""

import hashlib
import uuid
from collections.abc import Callable
from pathlib import Path
from typing import Any

from sqlmodel import Session, col, select

from app.core.config import get_settings
from app.db.session import release
from app.jobs.registry import HandlerResult, PermanentJobError
from app.models import Document, Job, Node, Recall, RecallGrade
from app.models.enums import RecallKind, ReviewSource
from app.pipeline.gates import schema_errors
from app.pipeline.runner import ModelRunner, OutputError, run_structured
from app.pipeline.skills import Skill, load_skill, render_prompt
from app.pipeline.tree import document_envelope
from app.recall.ideas import Idea, key_ideas
from app.services import reviews

SKILL_NAME = "grade-recall"


def origin(skill: Skill) -> str:
    return f"skill:{SKILL_NAME}@{skill.version}"


def prediction_for(session: Session, recall: Recall) -> Recall | None:
    """The latest prediction written for the chapter before this recall."""
    return session.exec(
        select(Recall)
        .where(
            Recall.document_id == recall.document_id,
            Recall.unit == recall.unit,
            Recall.kind == RecallKind.PREDICTION,
            col(Recall.created_at) <= recall.created_at,
        )
        .order_by(col(Recall.created_at).desc())
    ).first()


def recall_input(
    session: Session, recall: Recall, ideas: list[Idea], prediction: Recall | None
) -> dict[str, Any]:
    document = session.get(Document, recall.document_id)
    if document is None:  # pragma: no cover - cascades with the document
        raise PermanentJobError(f"recall {recall.id} has no document")
    heading = session.exec(
        select(Node.heading).where(Node.document_id == document.id, Node.anchor == recall.unit)
    ).first()
    return {
        "document": document_envelope(document),
        "scope": {"anchor": recall.unit, "kind": "chapter", "heading": heading},
        "ideas": [i.prompt() for i in ideas],
        "recall": recall.raw,
        "prediction": prediction.raw if prediction is not None else None,
    }


def checker(skill: Skill, ideas: list[Idea], predicted: bool) -> Callable[[Any], list[str]]:
    """Schema problems, then: every idea graded once, the question about a recalled idea,
    and a comparison exactly when there was a prediction."""
    ids = [i.id for i in ideas]

    def problems(output: Any) -> list[str]:
        found = schema_errors(skill.schema, output)
        if found or not isinstance(output, dict):
            return found
        graded = [v["id"] for v in output["ideas"]]
        if sorted(graded) != sorted(ids):
            return [f"grade every idea exactly once: {', '.join(ids)} (got {', '.join(graded)})"]
        status = {v["id"]: v["status"] for v in output["ideas"]}
        out: list[str] = []
        question = output["question"]
        if question is not None and status.get(question["idea"]) != "recalled":
            out.append(f"the question must be about a recalled idea, not {question['idea']}")
        if question is None and "recalled" in status.values():
            out.append("ask one 'why' question about an idea the reader recalled")
        comparison = output["comparison"]
        if predicted and comparison is None:
            out.append("the input has a prediction: fill `comparison`")
        if not predicted and comparison is not None:
            out.append("there is no prediction: `comparison` must be null")
        if comparison is not None and (unknown := set(comparison["ideas"]) - set(ids)):
            out.append(f"comparison cites ideas not in the input: {', '.join(sorted(unknown))}")
        return out

    return problems


def _gap_key(document_id: uuid.UUID, idea: Idea) -> str:
    digest = hashlib.sha256(idea.text.encode()).hexdigest()[:16]
    return f"{document_id}:{idea.cites[0]}:{digest}"


def _answer(idea: Idea) -> list[dict[str, Any]]:
    return [{"text": idea.text, "cites": idea.cites}]


def store(
    session: Session,
    recall: Recall,
    ideas: list[Idea],
    prediction: Recall | None,
    output: dict[str, Any],
    *,
    skill: Skill,
    model: str | None,
) -> RecallGrade:
    """Replace the recall's grade and queue its gaps and question. Commits."""
    by_id = {i.id: i for i in ideas}
    verdicts = {v["id"]: v for v in output["ideas"]}
    graded = [{**i.as_json(), **verdicts[i.id]} for i in ideas]
    question = output["question"]
    comparison = output["comparison"]
    existing = session.get(RecallGrade, recall.id)
    if existing is not None:
        session.delete(existing)
        session.flush()
    grade = RecallGrade(
        recall_id=recall.id,
        prediction_id=prediction.id if prediction is not None else None,
        ideas=graded,
        question={**question, "cites": by_id[question["idea"]].cites} if question else None,
        comparison={
            **comparison,
            "cites": [c for ref in comparison["ideas"] for c in by_id[ref].cites],
        }
        if comparison
        else None,
        origin=origin(skill),
        model=model,
    )
    session.add(grade)
    for verdict in graded:
        if verdict["status"] == "recalled":
            continue
        idea = by_id[verdict["id"]]
        draft = reviews.ItemDraft(
            document_id=recall.document_id,
            anchor=idea.cites[0],
            source=ReviewSource.RECALL,
            source_key=_gap_key(recall.document_id, idea),
            prompt=verdict["cue"],
            answer=_answer(idea),
        )
        reviews.add_item(session, draft, due=reviews.tomorrow())
    if question is not None:
        idea = by_id[question["idea"]]
        draft = reviews.ItemDraft(
            document_id=recall.document_id,
            anchor=idea.cites[0],
            source=ReviewSource.QUESTION,
            source_key=f"{recall.id}:why",
            prompt=question["text"],
            answer=_answer(idea),
        )
        reviews.add_item(session, draft)
    session.commit()
    session.refresh(grade)
    return grade


def grade_recall(
    session: Session, recall: Recall, *, runner: ModelRunner, skill: Skill
) -> tuple[RecallGrade, int | None]:
    """Grade one recall; returns the stored grade and the tokens the run cost."""
    if recall.kind is not RecallKind.RECALL:
        raise PermanentJobError(f"{recall.id} is a {recall.kind.value}, not a recall")
    ideas = key_ideas(session, recall.document_id, recall.unit)
    if not ideas:
        raise PermanentJobError(
            f"{recall.unit} has no key ideas to grade against: mark or distil it first"
        )
    prediction = prediction_for(session, recall)
    prompt = render_prompt(skill.prompt, recall_input(session, recall, ideas, prediction))
    validate = checker(skill, ideas, prediction is not None)
    release(session)  # no transaction open through the CLI run(s)
    try:
        run = run_structured(runner, prompt, tier=skill.meta.tier, validate=validate)
    except OutputError as exc:
        raise PermanentJobError(f"grade-recall gave no usable grade: {exc}") from exc
    grade = store(session, recall, ideas, prediction, run.output, skill=skill, model=run.model)
    return grade, run.cost_tokens


def run_grade_job(
    session: Session, job: Job, *, runner: ModelRunner, skills_dir: Path | None = None
) -> HandlerResult:
    """Handler body for `grade_recall`: `payload.recall_id` names the recall."""
    try:
        recall_id = uuid.UUID(str(job.payload.get("recall_id")))
    except ValueError as exc:
        raise PermanentJobError(f"payload.recall_id is not a uuid: {job.payload!r}") from exc
    recall = session.get(Recall, recall_id)
    if recall is None:
        raise PermanentJobError(f"recall {recall_id} does not exist")
    skill = load_skill((skills_dir or get_settings().skills_dir) / SKILL_NAME)
    grade, tokens = grade_recall(session, recall, runner=runner, skill=skill)
    counts = {
        s: sum(1 for i in grade.ideas if i["status"] == s)
        for s in ("recalled", "partial", "missed")
    }
    return HandlerResult(result={"recall_id": str(recall_id), **counts}, cost_tokens=tokens)

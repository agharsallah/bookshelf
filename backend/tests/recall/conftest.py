"""Fixtures for recall grading: a book whose first chapter has salience marks."""

import json
from typing import Any

import pytest
from sqlmodel import Session

from app.core.config import get_settings
from app.models import Document
from app.models.enums import ArtifactType
from app.pipeline.skills import Skill, load_skill
from app.recall.grading import SKILL_NAME
from tests.api.factories import make_artifact, make_book

MARKS = {
    "marks": [
        {
            "tier": "core",
            "text": "Text of ch01/s01/p001.",
            "cites": ["ch01/s01/p001"],
            "why": "Thesis.",
        },
        {"tier": "term", "text": "Text", "cites": ["ch01/s01/p001"], "why": "A term."},
        {
            "tier": "key",
            "text": "Text of ch01/s01/p002.",
            "cites": ["ch01/s01/p002"],
            "why": "Rests on it.",
        },
    ]
}


def grade(
    statuses: dict[str, str],
    question: str | None = "I1",
    comparison: dict[str, Any] | None = None,
) -> str:
    """A grade-recall reply: `statuses` is idea id → status."""
    ideas = [
        {"id": i, "status": s, "feedback": f"About {i}."}
        | ({} if s == "recalled" else {"cue": f"What does {i} say about text?"})
        for i, s in statuses.items()
    ]
    q = {"idea": question, "text": "Why is that true, given the text?"} if question else None
    return json.dumps({"ideas": ideas, "question": q, "comparison": comparison})


@pytest.fixture
def book(session: Session) -> Document:
    document = make_book(session)
    make_artifact(
        session,
        document,
        type=ArtifactType.SALIENCE_MARKS,
        anchor="ch01",
        body=MARKS,
        skill="mark-salience",
    )
    return document


@pytest.fixture
def skill() -> Skill:
    return load_skill(get_settings().skills_dir / SKILL_NAME)

"""A chapter's key ideas: the answer key a recall is graded against.

The preferred `salience_marks` (mark-salience) when the chapter has them: its core ideas and
key points, verbatim sentences each citing its block. Otherwise the preferred chapter
distillation's cited spans. Each idea gets a short id (`I1`, `I2`…) so the model grades by
id and every cite in the grade comes from here, never from the model.
"""

import uuid
from dataclasses import asdict, dataclass
from typing import Any

from sqlmodel import Session

from app.models.enums import ArtifactType
from app.pipeline import artifacts
from app.pipeline.bodies import count_words, leaf_spans

MAX_IDEAS = 25
_MIN_SPAN_WORDS = 6  # shorter distillation spans are labels and connectives, not claims
_TIERS = ("core", "key")


@dataclass(frozen=True, slots=True)
class Idea:
    id: str
    tier: str  # core | key
    text: str
    why: str | None
    cites: list[str]

    def prompt(self) -> dict[str, Any]:
        """What the model sees: no cites, which it has no use for."""
        return {"id": self.id, "tier": self.tier, "text": self.text, "why": self.why}

    def as_json(self) -> dict[str, Any]:
        return asdict(self)


def _numbered(drafts: list[tuple[str, str, str | None, list[str]]]) -> list[Idea]:
    return [
        Idea(id=f"I{i}", tier=tier, text=text, why=why, cites=cites)
        for i, (tier, text, why, cites) in enumerate(drafts[:MAX_IDEAS], start=1)
    ]


def from_marks(body: dict[str, Any]) -> list[Idea]:
    """Core ideas first when there are too many, then back in reading order."""
    marks = [
        (i, m)
        for i, m in enumerate(body.get("marks", []))
        if m.get("tier") in _TIERS and m.get("cites")
    ]
    kept = sorted(sorted(marks, key=lambda p: _TIERS.index(p[1]["tier"]))[:MAX_IDEAS])
    return _numbered([(m["tier"], m["text"], m.get("why"), list(m["cites"][:1])) for _, m in kept])


def from_distillation(body: dict[str, Any]) -> list[Idea]:
    seen: set[str] = set()
    drafts: list[tuple[str, str, str | None, list[str]]] = []
    for span in leaf_spans(body):
        text = str(span["text"]).strip()
        cites = [c for c in span["cites"] if isinstance(c, str)]
        if not cites or count_words(text) < _MIN_SPAN_WORDS or text in seen:
            continue
        seen.add(text)
        drafts.append(("key", text, None, cites))
    return _numbered(drafts)


def key_ideas(session: Session, document_id: uuid.UUID, unit: str) -> list[Idea]:
    """The chapter's key ideas, or [] when it has neither marks nor a distillation yet."""
    kinds = [ArtifactType.SALIENCE_MARKS, ArtifactType.CHAPTER_DISTILLATION]
    found = artifacts.preferred(session, document_id, kinds)
    marks = found.get((ArtifactType.SALIENCE_MARKS, unit))
    if marks is not None and (ideas := from_marks(marks.body)):
        return ideas
    distillation = found.get((ArtifactType.CHAPTER_DISTILLATION, unit))
    return from_distillation(distillation.body) if distillation is not None else []

"""Study material: quizzes, flashcards, quotes and glossaries, one pill per item.

Quiz questions and flashcard fronts are short by design ("About three weeks." is a fine
back), so the prose word bounds apply to quotes and definitions only.
"""

from app.models.enums import PillKind
from app.pills.contract import FlipBody, QuizBody, QuoteBody
from app.pills.harvest.base import (
    HarvestInput,
    PillDraft,
    build,
    clean_cites,
    draft,
    items,
    spans_cites,
    within_bounds,
)
from app.pills.harvest.distillations import definition_pill


def harvest_quiz(inp: HarvestInput) -> list[PillDraft]:
    out: list[PillDraft] = []
    for item in items(inp.artifact.body.get("items")):
        explanation = items(item.get("explanation"))
        body = build(
            QuizBody,
            question=item.get("question"),
            choices=item.get("choices"),
            answer=item.get("answer"),
            explanation=explanation,
        )
        if body is None:
            continue
        pill = draft(
            inp, PillKind.QUIZ, body, content=body.question, cites=spans_cites(explanation)
        )
        if pill is not None:
            out.append(pill)
    return out


def harvest_flashcards(inp: HarvestInput) -> list[PillDraft]:
    out: list[PillDraft] = []
    for item in items(inp.artifact.body.get("items")):
        back = items(item.get("back"))
        body = build(FlipBody, front=item.get("front"), back=back)
        if body is None:
            continue
        pill = draft(inp, PillKind.FLIP, body, content=body.front, cites=spans_cites(back))
        if pill is not None:
            out.append(pill)
    return out


def harvest_quotes(inp: HarvestInput) -> list[PillDraft]:
    out: list[PillDraft] = []
    for block in items(inp.artifact.body.get("blocks")):
        text = str(block.get("text") or "").strip()
        cites = clean_cites(block.get("cites", []))
        if block.get("type") != "quote" or not cites or not within_bounds(text):
            continue
        body = build(
            QuoteBody, text=text, page=block.get("page"), attribution=block.get("attribution")
        )
        if body is not None and (
            pill := draft(inp, PillKind.QUOTE, body, content=text, cites=cites)
        ):
            out.append(pill)
    return out


def harvest_glossary(inp: HarvestInput) -> list[PillDraft]:
    blocks = items(inp.artifact.body.get("blocks"))
    pills = [definition_pill(inp, b) for b in blocks if b.get("type") == "definition"]
    return [p for p in pills if p is not None]

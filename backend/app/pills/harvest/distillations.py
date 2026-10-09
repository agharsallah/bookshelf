"""Distillations and salience marks: callouts, definitions, diagrams, core ideas.

A chapter distillation (books, and a paper unit's `distil-paper-section`) holds render
blocks; three of them already are one idea each:

    callout  important · insight → insight, remember → remember, antipattern → antipattern
             (caution, contrast and question callouts lean on their paragraph: skipped)
    definition → definition        diagram → diagram (headline: the heading above it)

`mark-salience` marks the passages that carry a chapter; a `core` mark is its thesis, a
verbatim sentence of the book, and becomes an insight whose `why` is the mark's reason.
"""

from typing import Any

from app.models.enums import PillKind
from app.pills.contract import DefinitionBody, Diagram, DiagramBody, InsightBody, SpansBody
from app.pills.harvest.base import (
    HarvestInput,
    PillDraft,
    build,
    draft,
    items,
    spans_cites,
    spans_text,
    within_bounds,
)

CALLOUT_KINDS: dict[str, PillKind] = {
    "important": PillKind.INSIGHT,
    "insight": PillKind.INSIGHT,
    "remember": PillKind.REMEMBER,
    "antipattern": PillKind.ANTIPATTERN,
}


def _callout(inp: HarvestInput, block: dict[str, Any]) -> PillDraft | None:
    kind = CALLOUT_KINDS.get(str(block.get("tone")))
    spans = items(block.get("spans"))
    text = spans_text(spans)
    if kind is None or not within_bounds(text):
        return None
    model = InsightBody if kind is PillKind.INSIGHT else SpansBody
    body = build(model, spans=spans)
    if body is None:
        return None
    title = block.get("title")
    return draft(
        inp,
        kind,
        body,
        content=text,
        cites=spans_cites(spans),
        headline=title if isinstance(title, str) else None,
    )


def definition_pill(inp: HarvestInput, block: dict[str, Any]) -> PillDraft | None:
    """A `definition` block (distillations, glossaries) → a definition pill."""
    spans = items(block.get("spans"))
    term = str(block.get("term") or "").strip()
    text = spans_text(spans)
    body = build(DefinitionBody, term=term, spans=spans) if within_bounds(text) else None
    if body is None:
        return None
    return draft(
        inp,
        PillKind.DEFINITION,
        body,
        content=f"{term}\x1f{text}",
        cites=spans_cites(spans),
        concepts=[term],
    )


def diagram_pill(
    inp: HarvestInput, block: dict[str, Any], *, heading: str | None
) -> PillDraft | None:
    """A render `diagram` block → a diagram pill (cited, at least two boxes)."""
    diagram = build(Diagram, **block)
    if diagram is None or len(diagram.nodes) < 2 or not diagram.cites:
        return None
    labels = " ".join(n.label for n in diagram.nodes)
    return draft(
        inp,
        PillKind.DIAGRAM,
        DiagramBody(diagram=diagram),
        content=labels,
        cites=diagram.cites,
        headline=heading,
    )


def blocks_pills(inp: HarvestInput, blocks: list[dict[str, Any]]) -> list[PillDraft]:
    """Callouts, definitions and diagrams of a block list, in order."""
    out: list[PillDraft] = []
    heading: str | None = None
    for block in blocks:
        kind = block.get("type")
        pill: PillDraft | None = None
        if kind == "heading":
            heading = str(block.get("text") or "") or None
        elif kind == "callout":
            pill = _callout(inp, block)
        elif kind == "definition":
            pill = definition_pill(inp, block)
        elif kind == "diagram":
            pill = diagram_pill(inp, block, heading=heading)
        if pill is not None:
            out.append(pill)
    return out


def harvest_distillation(inp: HarvestInput) -> list[PillDraft]:
    return blocks_pills(inp, items(inp.artifact.body.get("blocks")))


def harvest_salience(inp: HarvestInput) -> list[PillDraft]:
    out: list[PillDraft] = []
    for mark in items(inp.artifact.body.get("marks")):
        text = str(mark.get("text") or "").strip()
        cites = [c for c in mark.get("cites", []) if isinstance(c, str)]
        if mark.get("tier") != "core" or not cites or not within_bounds(text):
            continue
        why = str(mark.get("why") or "").strip()
        body = build(
            InsightBody,
            spans=[{"text": text, "cites": cites}],
            why=[{"text": why, "cites": cites}] if why else None,
        )
        if body is not None and (
            pill := draft(inp, PillKind.INSIGHT, body, content=text, cites=cites)
        ):
            out.append(pill)
    return out

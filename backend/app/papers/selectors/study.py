"""Selectors of the paper study and critique skills (docs/PAPERS.md §4, §6).

    paper_assessment     assess-paper: the whole paper (unit distillations, abstract,
                         paper_meta), the preferred card, and the shelf (other papers'
                         TL;DRs and the shelf's concepts) for the `relevance` criterion
    paper_review         review-paper: the whole paper and the preferred card
    paper_notation       make-notation: every formula with the prose around it and its
                         describe-math explanation, as one reading-order `blocks` list, and
                         the formulas the unit distillations wrote out (inline maths)
    paper_journal_club   make-journal-club: the whole paper, the card, and the figures
                         (caption + describe-figure explanation) a key figure is picked from

The whole-paper selectors offer every unit to the `coverage_min` gate, as the card does.
"""

import uuid
from collections.abc import Callable
from typing import Any

from sqlmodel import Session, col, select

from app.models import Artifact, Document, Node
from app.models.enums import ArtifactType, Genre, NodeKind, Review
from app.papers.selectors import common
from app.papers.selectors.core import _paper_inputs
from app.papers.units import units
from app.pipeline import artifacts
from app.pipeline.bodies import plain_text
from app.pipeline.selectors import Context, Selection, SelectorError, _concepts, _figures
from app.pipeline.tree import Tree, block, document_envelope

SHELF_PAPERS_MAX = 60  # other papers' TL;DRs offered to the relevance criterion
MATH_MAX = 150  # formulas offered to make-notation (a long appendix can hold hundreds)
CONTEXT_BEFORE, CONTEXT_AFTER = 1, 2  # prose leaves kept around each formula
_PROSE = frozenset({NodeKind.PARAGRAPH, NodeKind.LIST, NodeKind.ASIDE, NodeKind.QUOTE})


def shelf_papers(session: Session, document_id: uuid.UUID) -> list[dict[str, Any]]:
    """Other papers on the shelf with a card: the document envelope plus the card's TL;DR
    as plain text (the preferred card per paper), by slug. Like `write-brief`'s `shelf`."""
    rows = session.exec(
        select(Artifact)
        .join(Document, col(Document.id) == col(Artifact.document_id))
        .where(
            Artifact.type == ArtifactType.PAPER_CARD,
            Artifact.document_id != document_id,
            Artifact.review != Review.REJECTED,
            Document.genre == Genre.PAPER,
        )
        .order_by(col(Artifact.version))
    ).all()
    cards = artifacts.pick_preferred(rows, lambda row: row.document_id)
    shelf = []
    for doc_id, card in cards.items():
        doc = session.get(Document, doc_id)
        if doc is not None:
            shelf.append({**document_envelope(doc), "tldr": plain_text(card.body.get("tldr"))})
    shelf.sort(key=lambda d: d["slug"])
    return shelf[:SHELF_PAPERS_MAX]


def _whole_paper(ctx: Context, **extra: Any) -> Selection:
    inputs = _paper_inputs(ctx)
    offered = tuple(item["anchor"] for item in inputs["unit_distillations"])
    card = {"paper_card": common.preferred_body(ctx, ArtifactType.PAPER_CARD)}
    return ctx.selection({**inputs, **card, **extra}, chapters=offered)


def paper_assessment(ctx: Context) -> Selection:
    shelf = {
        "papers": shelf_papers(ctx.session, ctx.tree.document.id),
        "concepts": _concepts(ctx.session),
    }
    return _whole_paper(ctx, shelf=shelf)


def paper_review(ctx: Context) -> Selection:
    return _whole_paper(ctx)


def figures(ctx: Context) -> list[dict[str, Any]]:
    """Every visible figure in reading order: `{anchor, caption, explanation}`, the
    explanation being its describe-figure `{takeaway, blocks}` (or None)."""
    nodes = [n for n in ctx.tree.leaves() if n.kind is NodeKind.FIGURE]
    explained = {
        f["anchor"]: {"takeaway": f["takeaway"], "blocks": f["blocks"]}
        for f in _figures(ctx, None, only={n.anchor for n in nodes})
    }
    return [
        {"anchor": n.anchor, "caption": n.text or "", "explanation": explained.get(n.anchor)}
        for n in nodes
    ]


def paper_journal_club(ctx: Context) -> Selection:
    return _whole_paper(ctx, figures=figures(ctx))


def has_math(tree: Tree) -> bool:
    """Whether the paper has a formula to build a notation table from."""
    return any(n.kind is NodeKind.MATH for n in tree.leaves())


def _context_window(tree: Tree, leaves: list[Node], index: int) -> list[Node]:
    """The formula at `index` with the prose leaves just before and after it, within the
    same chapter (where a paper says `where d_k is the dimension of the keys`)."""
    chapter = tree.chapter_of(leaves[index])
    lo, hi = max(0, index - CONTEXT_BEFORE), min(len(leaves), index + CONTEXT_AFTER + 1)
    return [
        n
        for n in leaves[lo:hi]
        if (n is leaves[index] or n.kind in _PROSE) and tree.chapter_of(n) is chapter
    ]


def paper_notation(ctx: Context) -> Selection:
    """`blocks`: the formulas (up to MATH_MAX) and the prose around them, plus the prose a unit
    distillation took an inline formula from, once each, in reading order, so `first_anchor`
    can be checked against the order; `math_descriptions`: the describe-math explanations of
    those formulas; `distilled_formulas`: the `math` blocks of the unit distillations (the
    formulas a paper writes inline, `C ∈ R^H`, reach the notes as LaTeX though the parser saw
    prose). Raises before a paper with neither."""
    leaves = ctx.tree.leaves()
    math = [i for i, n in enumerate(leaves) if n.kind is NodeKind.MATH][:MATH_MAX]
    distilled = distilled_formulas(ctx)
    if not math and not distilled:
        raise SelectorError("no formulas in this paper")
    kept = {n.anchor for i in math for n in _context_window(ctx.tree, leaves, i)}
    kept |= {c for f in distilled for c in f["cites"]}
    blocks = [block(n) for n in leaves if n.anchor in kept]
    anchors = {leaves[i].anchor for i in math}
    described = [
        {"anchor": f["anchor"], "takeaway": f["takeaway"], "blocks": f["blocks"]}
        for f in _figures(ctx, None, only=anchors)
    ]
    source_words = sum(len((b.get("text") or "").split()) for b in blocks)
    inputs = {"blocks": blocks, "math_descriptions": described, "distilled_formulas": distilled}
    return ctx.selection(inputs, source_words=source_words)


def distilled_formulas(ctx: Context) -> list[dict[str, Any]]:
    """The `math` blocks of the preferred unit distillations, in unit order: `{latex,
    meaning, cites}`, `meaning` as plain text and `cites` kept to the paper's leaf anchors.
    Empty before any unit is distilled."""
    kind = ArtifactType.CHAPTER_DISTILLATION
    found = artifacts.preferred(ctx.session, ctx.tree.document.id, [kind])
    leaf_anchors = {n.anchor for n in ctx.tree.leaves()}
    formulas: list[dict[str, Any]] = []
    for unit in units(ctx.tree):
        chosen = found.get((kind, unit.anchor))
        for item in chosen.body.get("blocks", []) if chosen else []:
            if not isinstance(item, dict) or item.get("type") != "math":
                continue
            cites = [c for c in item.get("cites") or [] if c in leaf_anchors]
            if item.get("latex") and cites:
                meaning = plain_text(item.get("meaning") or [])
                formulas.append({"latex": item["latex"], "meaning": meaning, "cites": cites})
    return formulas[:MATH_MAX]


SELECTORS: dict[str, Callable[[Context], Selection]] = {
    "paper_assessment": paper_assessment,
    "paper_review": paper_review,
    "paper_notation": paper_notation,
    "paper_journal_club": paper_journal_club,
}

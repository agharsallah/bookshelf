"""Selectors of the core paper skills (docs/PAPERS.md §4).

    paper_unit_blocks     distil-paper-section: one unit's blocks, its role, the explanations
                          of its figures, tables, code and formulas, and the works it cites
    paper_distillations   dissect-paper: every unit distillation, the abstract, paper_meta
    paper_explainer       simplify-paper: the same, plus the preferred paper card and the
                          shelf's concepts (so prerequisites can link to them)

The abstract and the paper outline are orientation: a unit's own blocks are its evidence.
"""

from collections.abc import Callable
from typing import Any

from app.models.enums import ArtifactType, NodeKind
from app.papers.selectors import common
from app.papers.units import units
from app.pipeline.bodies import count_words, plain_text
from app.pipeline.selectors import (
    Context,
    Selection,
    SelectorError,
    _concepts,  # the shelf's concepts, as link-concepts and write-guide read them
    _figures,  # checked element explanations under a scope, as scope_blocks reads them
)
from app.pipeline.tree import block


def paper_unit_blocks(ctx: Context) -> Selection:
    """One unit (a top-level section): all its leaves in reading order, with the headings of
    its subsections, its role, the paper's outline and abstract for orientation, the element
    explanations under it, and the bibliography entries it cites."""
    unit = ctx.require_node()
    if unit.kind is not NodeKind.CHAPTER or unit.anchor not in {u.anchor for u in units(ctx.tree)}:
        raise SelectorError(f"{unit.anchor} is not a unit of this paper")
    leaves = ctx.leaves()
    if not leaves:
        raise SelectorError("no blocks under this unit")
    figures = _figures(ctx, unit)
    # The note may copy the figures' checked explanations (their transcribed tables and
    # descriptions), so they count as source for the compression band too.
    figure_words = count_words(plain_text({"blocks": [b for f in figures for b in f["blocks"]]}))
    return ctx.selection(
        {
            "role": common.role_name(unit),
            "paper": {
                "outline": common.outline(ctx.tree),
                "abstract": common.abstract_text(ctx.session, ctx.tree),
            },
            "subsections": common.subsections(ctx.tree, unit),
            "blocks": [block(n) for n in leaves],
            "figures": figures,
            "references": common.cited_references(ctx.session, ctx.tree, unit),
        },
        source_words=ctx.source_words() + figure_words,
    )


def _paper_inputs(ctx: Context) -> dict[str, Any]:
    return {
        "paper_meta": common.paper_meta(ctx.session, ctx.tree),
        "abstract": common.abstract(ctx.session, ctx.tree),
        "unit_distillations": common.unit_distillations(ctx),
    }


def paper_distillations(ctx: Context) -> Selection:
    """The whole paper through its unit distillations. `chapters` lists the units offered,
    for the `coverage_min` gate: a card that never cites the method or the results is
    missing half the paper."""
    inputs = _paper_inputs(ctx)
    offered = tuple(item["anchor"] for item in inputs["unit_distillations"])
    return ctx.selection(inputs, chapters=offered)


def paper_explainer(ctx: Context) -> Selection:
    """`paper_distillations` plus the preferred `paper_card` (or None before one exists)
    and the shelf's concepts. The level comes from the run's params (`inputs.params`)."""
    inputs = _paper_inputs(ctx)
    offered = tuple(item["anchor"] for item in inputs["unit_distillations"])
    extra = {
        "paper_card": common.preferred_body(ctx, ArtifactType.PAPER_CARD),
        "existing_concepts": _concepts(ctx.session),
    }
    return ctx.selection({**inputs, **extra}, chapters=offered)


SELECTORS: dict[str, Callable[[Context], Selection]] = {
    "paper_unit_blocks": paper_unit_blocks,
    "paper_distillations": paper_distillations,
    "paper_explainer": paper_explainer,
}

"""Selector of `extract-results` (docs/PAPERS.md §4): where a paper reports its numbers.

    units         the results and experiments units, every block (an untagged paper, or
                  one structure found no such unit in: every unit)
    tables        table and figure blocks outside those units (an appendix table)
    explanations  the table explanations and figure descriptions of every table and
                  figure (a description's `chart` block is the data read off a plot)
    setup         dataset, baseline and metric names from the preferred paper card, so
                  rows spell them the same way (names only: orientation, not evidence)

The cite gate is the Selection's `valid_anchors`: a row may cite a block of those units or a
table or figure block, nothing else, and anything else is a hard error the runner retries.
"""

from collections.abc import Callable
from dataclasses import replace
from typing import Any

from app.models import Node
from app.models.enums import ArtifactType, NodeKind, SectionRole
from app.papers.selectors import common
from app.papers.units import role_of, units
from app.pipeline.bodies import count_words
from app.pipeline.selectors import Context, Selection, SelectorError, _figures
from app.pipeline.tree import Tree, block

RESULT_ROLES = frozenset({SectionRole.EXPERIMENTS, SectionRole.RESULTS})
RESULT_KINDS = frozenset({NodeKind.TABLE, NodeKind.FIGURE})
_SETUP_KEYS = ("datasets", "baselines", "metrics")


def result_units(tree: Tree) -> list[Node]:
    """The units that report results; every unit when none is tagged so."""
    found = units(tree)
    tagged = [u for u in found if role_of(u) in RESULT_ROLES]
    return tagged or found


def _setup(card: dict[str, Any] | None) -> dict[str, list[str]] | None:
    setup = card.get("setup") if isinstance(card, dict) else None
    if not isinstance(setup, dict):
        return None
    return {
        key: [str(i["name"]) for i in setup.get(key, []) if isinstance(i, dict) and i.get("name")]
        for key in _SETUP_KEYS
    }


def paper_results(ctx: Context) -> Selection:
    """The results and experiments units, the paper's tables and figures, their
    explanations, and the card's setup names. Only their anchors may be cited."""
    offered = result_units(ctx.tree)
    inside = {n.anchor for u in offered for n in [u, *ctx.tree.walk(u)]}
    elements = [n for n in ctx.tree.leaves() if n.kind in RESULT_KINDS]
    tables = [n for n in elements if n.anchor not in inside]
    if not offered and not tables:
        raise SelectorError("no results, experiments, tables or figures to read")
    unit_items = [
        {
            "anchor": u.anchor,
            "heading": u.heading,
            "role": common.role_name(u),
            "blocks": [block(n) for n in ctx.tree.leaves(u)],
        }
        for u in offered
    ]
    inputs = {
        "paper_meta": common.paper_meta(ctx.session, ctx.tree),
        "setup": _setup(common.preferred_body(ctx, ArtifactType.PAPER_CARD)),
        "units": unit_items,
        "tables": [block(n) for n in tables],
        "explanations": _figures(ctx, None, only={n.anchor for n in elements}),
    }
    words = sum(count_words(n.text or "") for u in offered for n in ctx.tree.leaves(u))
    words += sum(count_words(n.text or "") for n in tables)
    allowed = frozenset(inside | {n.anchor for n in elements})
    selection = ctx.selection(inputs, source_words=words)
    return replace(selection, valid_anchors=allowed, visible_anchors=allowed)


SELECTORS: dict[str, Callable[[Context], Selection]] = {"paper_results": paper_results}

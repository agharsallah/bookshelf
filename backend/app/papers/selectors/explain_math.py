"""The selector of explain-math (docs/PAPERS.md §4): the paper's maths, taught from zero.

    paper_math   the notation selector's input (every formula with the prose around it,
                 the describe-math explanations, the formulas the unit notes wrote out
                 from inline prose), plus the preferred notation table and paper card
                 (what each symbol means, what the paper is for) and the shelf's
                 concepts (explore_further points at them)

It builds on `study.paper_notation`, so both skills see the same formulas in the same
reading order, and it raises the same `SelectorError` before a paper without any.
"""

from collections.abc import Callable
from typing import Any

from app.models.enums import ArtifactType
from app.papers.selectors import common
from app.papers.selectors.study import paper_notation
from app.pipeline.selectors import Context, Selection, _concepts


def notation_symbols(ctx: Context) -> list[dict[str, Any]] | None:
    """The preferred notation table's symbols (approved, else the newest draft), or None
    before make-notation has run."""
    body = common.preferred_body(ctx, ArtifactType.NOTATION_TABLE)
    if body is None:
        return None
    return [s for s in body.get("symbols", []) if isinstance(s, dict)]


def paper_math(ctx: Context) -> Selection:
    """`blocks`, `math_descriptions`, `distilled_formulas` (as for make-notation), plus
    `notation_table`, `paper_card` (or None each) and `existing_concepts`."""
    formulas = paper_notation(ctx)
    base = ctx.base()
    inputs = {k: v for k, v in formulas.inputs.items() if k not in base}
    inputs |= {
        "notation_table": notation_symbols(ctx),
        "paper_card": common.preferred_body(ctx, ArtifactType.PAPER_CARD),
        "existing_concepts": _concepts(ctx.session),
    }
    return ctx.selection(inputs, source_words=formulas.source_words)


SELECTORS: dict[str, Callable[[Context], Selection]] = {"paper_math": paper_math}

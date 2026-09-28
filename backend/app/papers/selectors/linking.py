"""Selector of `link-paper-concepts` (docs/PAPERS.md §4): a paper's slice of the idea graph.

    unit_distillations  every unit's preferred chapter distillation (as dissect-paper reads)
    paper_card          the preferred card, or null: contributions, method and the setup's
                        datasets, baselines and metrics
    results_table       the preferred results table, or null before extract-results ran:
                        the method, dataset and metric names comparisons are joined on
    existing_concepts   the shelf's concepts, as link-concepts reads them

`link_paper_concepts` runs after embed, when the by-products may still be in flight; an
approved results table re-queues it (`papers.profile`), so its names reach the graph.
"""

from collections.abc import Callable

from app.models.enums import ArtifactType
from app.papers.selectors import common
from app.pipeline.selectors import Context, Selection, _concepts


def paper_concepts(ctx: Context) -> Selection:
    """The unit distillations, the card, the results table and the shelf's concepts."""
    return ctx.selection(
        {
            "unit_distillations": common.unit_distillations(ctx),
            "paper_card": common.preferred_body(ctx, ArtifactType.PAPER_CARD),
            "results_table": common.preferred_body(ctx, ArtifactType.RESULTS_TABLE),
            "existing_concepts": _concepts(ctx.session),
        }
    )


SELECTORS: dict[str, Callable[[Context], Selection]] = {"paper_concepts": paper_concepts}

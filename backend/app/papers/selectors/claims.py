"""Selector of the claim tracker's extraction skill (docs/PAPERS.md P4, §4 extract-claims).

    paper_claims   extract-claims: every unit distillation (with its role, which the
                   `measured` gate reads), the abstract, paper_meta, and the preferred paper
                   card as orientation (its contributions say what the authors call central)

The units offered feed `coverage_min`, as for the card: a claim set that never reaches the
method or the results is missing what the paper asserts.
"""

from collections.abc import Callable

from app.models.enums import ArtifactType
from app.papers.selectors import common
from app.pipeline.selectors import Context, Selection


def paper_claims(ctx: Context) -> Selection:
    """The paper through its unit distillations, plus its card (or None before one)."""
    distillations = common.unit_distillations(ctx)
    inputs = {
        "paper_meta": common.paper_meta(ctx.session, ctx.tree),
        "abstract": common.abstract(ctx.session, ctx.tree),
        "unit_distillations": distillations,
        "paper_card": common.preferred_body(ctx, ArtifactType.PAPER_CARD),
    }
    return ctx.selection(inputs, chapters=tuple(item["anchor"] for item in distillations))


SELECTORS: dict[str, Callable[[Context], Selection]] = {
    "paper_claims": paper_claims,
}

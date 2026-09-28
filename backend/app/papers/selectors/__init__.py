"""Input selectors of the paper skills (skills/README.md "Input envelope").

Each module exports a `SELECTORS` dict; this package merges them, and
`app.pipeline.selectors.registry()` merges the result into the pipeline's registry on first
use (lazily: these modules build on its `Context` and `Selection`). A new paper skill adds a
module here and one line below; nothing in `app/pipeline` changes.

    common.py   shared pieces: paper meta, the abstract, unit outline, unit distillations
    core.py     paper_unit_blocks · paper_distillations · paper_explainer
    claims.py   paper_claims
    study.py    paper_assessment · paper_review · paper_notation · paper_journal_club
    results.py  paper_results (extract-results)
    citing.py   paper_citations (classify-citations)
    linking.py  paper_concepts (link-paper-concepts)
"""

from collections.abc import Callable

from app.papers.selectors import citing, claims, core, linking, results, study
from app.pipeline.selectors import Context, Selection

SELECTORS: dict[str, Callable[[Context], Selection]] = {
    **core.SELECTORS,
    **claims.SELECTORS,
    **study.SELECTORS,
    **results.SELECTORS,
    **citing.SELECTORS,
    **linking.SELECTORS,
}

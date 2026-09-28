"""The paper pipeline profile (docs/PAPERS.md §3, P2): the orchestrator's rules for a paper.

`orchestrator.rules_for(document)` hands a paper these tables instead of the book's. They
start from the book tables and override only what differs, so everything else (derive
narration, embed → link, graph refresh, reopen) behaves exactly as for a book:

    parse → paper_structure (roles, abstract, paper_meta, references, in-text cites)
          → describe_figure · explain_code · describe_math · explain_table   (as for books)
          → (all element jobs finished) distil_paper_section per unit     (no section notes,
                                                                            no summaries)
          → (every unit distilled) dissect_paper → paper_card
          → human approves the card → distilled: embed + PAPER_DERIVES
          → embed → link_paper_concepts → linked, graph refresh    (papers.graph_rules)

Units are `papers.units.units(tree)`: the top-level sections minus the abstract (the card
reads it verbatim) and the references. `distil_paper_section` writes `chapter_distillation`
on the unit's anchor, so the reader's distillation pane works unchanged.

`paper_enrich` (OpenAlex metadata, reference resolution) is queued next to the element jobs
once structure is known; nothing in the distillation chain waits on it.

A projected type (`claim_set` → `claims`, …; `papers.materialize.MATERIALIZERS`) is
re-materialized on every verdict that can change its effective version: approve, edit,
reject, reopen (`Rules.after_reopen`).

Adding a paper by-product skill is one line: append a `Derive` to `PAPER_DERIVES`. Another
Python job that must follow `paper_structure` goes in `AFTER_STRUCTURE`.
"""

import uuid
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field

from sqlmodel import Session

from app.core.config import get_settings
from app.jobs.queue import JobSpec
from app.models import Artifact, Job
from app.models.enums import ArtifactType, DocumentStatus, JobKind, JobState, Review
from app.papers import graph_rules
from app.papers.enrich import enrich_spec
from app.papers.materialize import MATERIALIZERS, materialize
from app.papers.selectors.citing import has_citations
from app.papers.selectors.study import has_math
from app.papers.units import unit_of, units
from app.pipeline import artifacts
from app.pipeline.orchestrator import (
    AFTER_APPROVAL,
    AFTER_JOB,
    AFTER_REJECTION,
    ELEMENT_KINDS,
    PRIORITY,
    Plan,
    Rules,
    State,
    element_job,
    guide_approved,
)
from app.pipeline.skills import load_catalogue
from app.pipeline.tree import Tree
from app.services import app_settings

# By-products run as `derive` jobs once the card is approved, at the book guide's priority:
# they read the unit distillations and the approved card, not the index.
DERIVE_PRIORITY = PRIORITY[JobKind.DISSECT_PAPER] + 5


@dataclass(frozen=True, slots=True)
class Derive:
    """One by-product skill the approved card queues. `variant` is the skill's episode key
    for `params` (its meta.yaml `variant` filled in), so the job dedupes with the same run
    queued by hand (`services.jobs.job_spec`: `skill:<name>:<variant>`). `when`, if set,
    says whether this paper has what the skill needs (no formulas, no notation table)."""

    skill: str
    params: Mapping[str, str | int] = field(default_factory=dict)
    variant: str | None = None
    priority: int = DERIVE_PRIORITY
    when: Callable[[Tree], bool] | None = None

    def applies(self, tree: Tree) -> bool:
        return self.when is None or self.when(tree)

    @property
    def key(self) -> str:
        return f"skill:{self.skill}" + (f":{self.variant}" if self.variant else "")

    def spec(self, document_id: uuid.UUID) -> JobSpec:
        return JobSpec(
            kind=JobKind.DERIVE,
            document_id=document_id,
            skill=self.skill,
            input_hash=self.key,
            payload={"params": dict(self.params)} if self.params else None,
            priority=self.priority,
        )


# The paper's by-products, in queue order. Later skills append here (docs/PAPERS.md §4);
# `tests/papers/test_profile.py` checks each entry against its skill package.
PAPER_DERIVES: list[Derive] = [
    Derive("simplify-paper", {"level": "practitioner"}, variant="practitioner"),
    Derive("assess-paper"),
    Derive("review-paper"),
    Derive("make-notation", when=has_math),
    Derive("explain-math", when=has_math),
    Derive("make-journal-club"),
    Derive("extract-claims"),  # claim_set → claims (papers.materialize)
    Derive("extract-results"),
    Derive("classify-citations", when=has_citations),
]
# By-products search indexes (`retrieval.points.INDEXED_TYPES`): approving one after the
# card's embed re-indexes the paper, as an approved book guide does.
INDEXED_DERIVES = frozenset(
    {
        ArtifactType.PAPER_EXPLAINER,
        ArtifactType.PAPER_ASSESSMENT,
        ArtifactType.PAPER_REVIEW,
        ArtifactType.NOTATION_TABLE,
        ArtifactType.JOURNAL_CLUB,
        ArtifactType.MATH_EXPLAINER,
    }
)
# Independent jobs queued next to the element jobs once structure is known (per document).
AFTER_STRUCTURE: list[Callable[[uuid.UUID], JobSpec]] = [enrich_spec]


# --- Rules -----------------------------------------------------------------------------


def _unit_jobs(state: State) -> list[JobSpec]:
    return [state.spec(JobKind.DISTIL_PAPER_SECTION, u.anchor) for u in units(state.tree)]


def start(state: State) -> Plan:
    """A parsed paper: tag its structure first; every later stage reads the roles."""
    if state.document.status is not DocumentStatus.PARSED:
        return Plan()
    return Plan(jobs=[state.spec(JobKind.PAPER_STRUCTURE)])


def structure_finished(state: State, job: Job) -> Plan:
    """Roles are known: explain the elements, or (none) distil the units straight away.
    Re-runnable (after an outline fix): the queue and the idempotent handler absorb repeats."""
    extra = [build(state.document.id) for build in AFTER_STRUCTURE]
    elements = [
        state.spec(kind, leaf.anchor)
        for leaf in state.tree.leaves()
        if (kind := element_job(leaf)) is not None
    ]
    if elements:  # unit distillations wait for the explanations they will cite
        return Plan(jobs=extra + elements, status=DocumentStatus.ENRICHING)
    return Plan(jobs=extra + _unit_jobs(state), status=DocumentStatus.DISTILLING)


def element_finished(state: State, job: Job) -> Plan:
    """The last element explanation (done, skipped or failed) releases the units."""
    if state.live_jobs(ELEMENT_KINDS):
        return Plan()
    return Plan(jobs=_unit_jobs(state), status=DocumentStatus.DISTILLING)


def _card_if_complete(state: State) -> Plan:
    found = units(state.tree)
    if found and all(state.has(ArtifactType.CHAPTER_DISTILLATION, u.anchor) for u in found):
        return Plan(jobs=[state.spec(JobKind.DISSECT_PAPER)])
    return Plan()


def unit_finished(state: State, job: Job) -> Plan:
    return _card_if_complete(state)


def card_finished(state: State, job: Job) -> Plan:
    """Like `brief_finished`: a dissect run that was an idempotency hit on an *approved*
    card counts as that approval; a new card waits for a human."""
    covering = (job.result or {}).get("artifact_id") if job.state is JobState.SKIPPED else None
    card = state.session.get(Artifact, uuid.UUID(covering)) if isinstance(covering, str) else None
    if card is None or card.review is not Review.APPROVED:
        return Plan()
    return card_approved(state, card)


def card_approved(state: State, artifact: Artifact) -> Plan:
    """The card is the paper's brief: the paper is distilled, indexed next, and its
    by-products are written from the distillations and the approved card."""
    document, tree = state.document, state.tree

    def derives(session: Session) -> list[JobSpec]:
        """`PAPER_DERIVES` until the settings choose: then a listed by-product keeps its
        params and `when`, and any other eligible skill runs as it is."""
        known = {d.skill: d for d in PAPER_DERIVES}
        chosen = app_settings.stored_auto_derive(session).get("paper")
        if chosen is None:
            return [d.spec(document.id) for d in PAPER_DERIVES if d.applies(tree)]
        allowed = app_settings.eligible(load_catalogue(get_settings().skills_dir), "paper")
        return [
            known[name].spec(document.id)
            if name in known
            else app_settings.derive_spec(allowed[name], document.id)
            for name in chosen
            if name in allowed and (name not in known or known[name].applies(tree))
        ]

    return Plan(
        jobs=[state.spec(JobKind.EMBED)], status=DocumentStatus.DISTILLED, effects=[derives]
    )


def distillation_approved(state: State, artifact: Artifact) -> Plan:
    """A corrected unit distillation changes the card's inputs: dissect again."""
    return _card_if_complete(state)


def element_approved(state: State, artifact: Artifact) -> Plan:
    """An approved (possibly low-confidence) explanation now feeds its unit's distillation."""
    node = state.node(artifact.anchor)
    unit = unit_of(state.tree, node) if node is not None else None
    if unit is None:
        return Plan()
    return Plan(jobs=[state.spec(JobKind.DISTIL_PAPER_SECTION, unit.anchor)])


def materialized(state: State, artifact: Artifact) -> Plan:
    """Approve, edit, reject or reopen of a projected type (`papers.materialize`): the table
    follows the effective version; the materializer says what to queue after it."""
    document = state.document
    return Plan(effects=[lambda session: materialize(session, document, artifact.type)])


RULES = Rules(
    start=start,
    after_job={
        **AFTER_JOB,
        JobKind.PARSE: lambda state, job: start(state),
        **graph_rules.AFTER_JOB,  # embed → link_paper_concepts, cites edges
        JobKind.PAPER_STRUCTURE: graph_rules.with_cites(structure_finished),
        **dict.fromkeys(ELEMENT_KINDS, element_finished),
        JobKind.DISTIL_PAPER_SECTION: unit_finished,
        JobKind.DISSECT_PAPER: card_finished,
    },
    after_approval={
        **AFTER_APPROVAL,
        ArtifactType.CHAPTER_DISTILLATION: distillation_approved,
        ArtifactType.PAPER_CARD: card_approved,
        ArtifactType.RESULTS_TABLE: graph_rules.results_approved,
        **dict.fromkeys(INDEXED_DERIVES, guide_approved),
        **dict.fromkeys(artifacts.ELEMENT_TYPES, element_approved),
        **dict.fromkeys(MATERIALIZERS, materialized),
    },
    after_rejection={**AFTER_REJECTION, **dict.fromkeys(MATERIALIZERS, materialized)},
    after_reopen=dict.fromkeys(MATERIALIZERS, materialized),
)

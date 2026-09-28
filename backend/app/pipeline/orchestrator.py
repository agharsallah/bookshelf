"""The §7 state machine: what to enqueue next when a job finishes or a human reviews.

Three lookup tables drive everything, so the pipeline reads top to bottom:

    AFTER_JOB[kind](state, job)            -> Plan  (worker, after every terminal job)
    AFTER_APPROVAL[type](state, artifact)  -> Plan  (review API, approve / edit / human write)
    AFTER_REJECTION[type](state, artifact) -> Plan  (review API, reject)

A rule only *reads* (`State`) and returns a `Plan`; `_apply` runs the plan's effects (graph
writes, which may hand back more jobs), enqueues, and moves the document status forward.
Enqueueing is always safe to repeat: the queue dedupes queued work and the handler skips
unchanged inputs, so rules may over-enqueue but never pay twice.

Pipeline order per document:

    parse → describe_figure · explain_code · describe_math · explain_table · summarize
          → (all element jobs finished) distil_section per section scope
          → (all section notes of a chapter) distil_chapter
          → (every chapter distilled) brief + the book guide (derive: write-guide)
          → human approves the brief → embed
          → link_concepts → linked
          → (concept_links applied to the idea graph) dedup: link_concepts, mode=dedup

A paper (`genre = paper`) runs its own profile, `app.papers.profile` (docs/PAPERS.md §3):
`rules_for(document)` picks the tables, so book rules stay as they are.
"""

import logging
import uuid
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field

from sqlmodel import Session, col, func, select

from app.audio import narration
from app.core.config import get_settings
from app.graph import pipeline as graph
from app.jobs import queue
from app.jobs.queue import JobSpec
from app.models import Artifact, Document, Job, Node
from app.models.enums import (
    ArtifactType,
    DocumentStatus,
    Genre,
    JobKind,
    JobState,
    NodeKind,
    Review,
)
from app.pipeline import artifacts
from app.pipeline.skills import load_catalogue
from app.pipeline.tree import Tree
from app.retrieval.points import INDEXED_TYPES
from app.services import app_settings

logger = logging.getLogger(__name__)

ELEMENT_KINDS = frozenset(
    {JobKind.DESCRIBE_FIGURE, JobKind.EXPLAIN_CODE, JobKind.DESCRIBE_MATH, JobKind.EXPLAIN_TABLE}
)
# Lower runs first: element explanations feed section notes, notes feed chapters, ...
PRIORITY: dict[JobKind, int] = {
    JobKind.DESCRIBE_FIGURE: 40,
    JobKind.EXPLAIN_CODE: 40,
    JobKind.DESCRIBE_MATH: 40,
    JobKind.EXPLAIN_TABLE: 40,
    JobKind.SUMMARIZE: 60,
    JobKind.DISTIL_SECTION: 80,
    JobKind.DISTIL_CHAPTER: 90,
    JobKind.BRIEF: 100,
    JobKind.EMBED: 110,
    JobKind.LINK_CONCEPTS: 120,
    # Papers (app.papers.profile): structure, then the unit, card and link stages.
    JobKind.PAPER_STRUCTURE: 30,
    JobKind.DISTIL_PAPER_SECTION: 80,
    JobKind.DISSECT_PAPER: 100,
    JobKind.LINK_PAPER_CONCEPTS: 120,
}
# The in-depth book guide reads what the brief reads; it runs as a `derive` job, right after.
GUIDE_SKILL = "write-guide"
_GUIDE_PRIORITY = PRIORITY[JobKind.BRIEF] + 5
# Statuses in which nothing advances: not parsed yet, or the outline waits for a human.
BLOCKED = frozenset(
    {
        DocumentStatus.REGISTERED,
        DocumentStatus.PARSING,
        DocumentStatus.PARSE_FAILED,
        DocumentStatus.NEEDS_REVIEW,
    }
)
# Status only moves forward along this order (re-runs never drag a document back).
_RANK: dict[DocumentStatus, int] = {
    DocumentStatus.PARSED: 0,
    DocumentStatus.ENRICHING: 1,
    DocumentStatus.DISTILLING: 2,
    DocumentStatus.DISTILLED: 3,
    DocumentStatus.INDEXED: 4,
    DocumentStatus.LINKED: 5,
    DocumentStatus.DERIVING: 5,
}
_TABLE_ROWS_WITHOUT_EXPLANATION = 6


# A side effect a rule asks for: runs inside `_apply`, may return more jobs to enqueue.
Effect = Callable[[Session], list[JobSpec]]


@dataclass(slots=True)
class Plan:
    jobs: list[JobSpec] = field(default_factory=list)
    status: DocumentStatus | None = None
    effects: list[Effect] = field(default_factory=list)


@dataclass(slots=True)
class State:
    """What rules may look at: the document, its tree, its live artifacts and jobs."""

    session: Session
    document: Document
    tree: Tree
    _scopes: dict[ArtifactType, set[str | None]] = field(default_factory=dict)

    def has(self, kind: ArtifactType, anchor: str | None) -> bool:
        """A live (non-rejected) artifact of `kind` exists for this scope."""
        if kind not in self._scopes:
            found = artifacts.preferred(self.session, self.document.id, [kind])
            self._scopes[kind] = {scope for _, scope in found}
        return anchor in self._scopes[kind]

    def live_jobs(self, kinds: frozenset[JobKind]) -> int:
        return int(
            self.session.exec(
                select(func.count())
                .select_from(Job)
                .where(
                    Job.document_id == self.document.id,
                    col(Job.kind).in_(list(kinds)),
                    col(Job.state).in_([JobState.QUEUED, JobState.RUNNING]),
                )
            ).one()
        )

    def spec(self, kind: JobKind, anchor: str | None = None) -> JobSpec:
        return JobSpec(
            kind=kind, document_id=self.document.id, anchor=anchor, priority=PRIORITY[kind]
        )

    def guide_spec(self) -> JobSpec:
        """The `derive` job for the book guide, keyed like a manual run (`skill:<name>`) so
        the queue dedupes the two."""
        return JobSpec(
            kind=JobKind.DERIVE,
            document_id=self.document.id,
            skill=GUIDE_SKILL,
            input_hash=f"skill:{GUIDE_SKILL}",
            priority=_GUIDE_PRIORITY,
        )

    def node(self, anchor: str | None) -> Node | None:
        return self.tree.by_anchor.get(anchor) if anchor is not None else None


# --- Which elements get their own explanation (§8) -------------------------------------


def element_job(node: Node) -> JobKind | None:
    meta = node.meta
    if node.kind is NodeKind.FIGURE:
        return JobKind.DESCRIBE_FIGURE
    if node.kind is NodeKind.CODE:
        return JobKind.EXPLAIN_CODE
    if node.kind is NodeKind.MATH and not meta.get("inline"):
        return JobKind.DESCRIBE_MATH
    if node.kind is NodeKind.TABLE:
        table = meta.get("table")
        rows = meta.get("rows") or (table.get("rows") if isinstance(table, dict) else None) or []
        if len(rows) > _TABLE_ROWS_WITHOUT_EXPLANATION or not meta.get("caption"):
            return JobKind.EXPLAIN_TABLE
    return None


# --- Rules -----------------------------------------------------------------------------


def _section_jobs(state: State) -> list[JobSpec]:
    return [
        state.spec(JobKind.DISTIL_SECTION, scope.anchor)
        for chapter in state.tree.chapters()
        for scope in state.tree.section_scopes(chapter)
    ]


def start_distillation(state: State) -> Plan:
    """A parsed document: explain its elements, summarize chapters, then distil."""
    if state.document.status is not DocumentStatus.PARSED:
        return Plan()
    elements = [
        state.spec(kind, leaf.anchor)
        for leaf in state.tree.leaves()
        if (kind := element_job(leaf)) is not None
    ]
    summaries = [state.spec(JobKind.SUMMARIZE, ch.anchor) for ch in state.tree.chapters()]
    if elements:  # section notes wait for the element explanations they will cite
        return Plan(jobs=elements + summaries, status=DocumentStatus.ENRICHING)
    return Plan(jobs=summaries + _section_jobs(state), status=DocumentStatus.DISTILLING)


def element_finished(state: State, job: Job) -> Plan:
    """The last element explanation (done, skipped or failed) releases the section notes."""
    if state.live_jobs(ELEMENT_KINDS):
        return Plan()
    return Plan(jobs=_section_jobs(state), status=DocumentStatus.DISTILLING)


def _chapter_if_complete(state: State, anchor: str | None) -> Plan:
    node = state.node(anchor)
    chapter = state.tree.chapter_of(node) if node is not None else None
    if chapter is None:
        return Plan()
    scopes = state.tree.section_scopes(chapter)
    if all(state.has(ArtifactType.SECTION_NOTE, s.anchor) for s in scopes):
        return Plan(jobs=[state.spec(JobKind.DISTIL_CHAPTER, chapter.anchor)])
    return Plan()


def _brief_if_complete(state: State) -> Plan:
    chapters = state.tree.chapters()
    if chapters and all(state.has(ArtifactType.CHAPTER_DISTILLATION, c.anchor) for c in chapters):
        return Plan(jobs=[state.spec(JobKind.BRIEF), state.guide_spec()])
    return Plan()


def section_finished(state: State, job: Job) -> Plan:
    return _chapter_if_complete(state, job.anchor)


def chapter_finished(state: State, job: Job) -> Plan:
    return _brief_if_complete(state)


def brief_finished(state: State, job: Job) -> Plan:
    """A brief run that was an idempotency hit on an *approved* brief (e.g. after a re-parse
    changed nothing it reads) counts as that approval: index again, as `brief_approved`.
    A new brief waits for a human, as always."""
    covering = (job.result or {}).get("artifact_id") if job.state is JobState.SKIPPED else None
    brief = state.session.get(Artifact, uuid.UUID(covering)) if isinstance(covering, str) else None
    if brief is None or brief.review is not Review.APPROVED:
        return Plan()
    return brief_approved(state, brief)


def derive_finished(state: State, job: Job) -> Plan:
    """A narrated skill's script (new, or an unchanged input's existing one) is voiced by
    the cast the job asked for (`payload.voices`, set by `POST /jobs`)."""
    voices = job.payload.get("voices")
    made = (job.result or {}).get("artifact_id")
    if not isinstance(voices, list) or not isinstance(made, str):
        return Plan()
    script = state.session.get(Artifact, uuid.UUID(made))
    if script is None or script.type is not ArtifactType.AUDIO_SUMMARY:
        return Plan()
    return Plan(jobs=[narration.narrate_spec(script, [str(v) for v in voices])])


def embed_finished(state: State, job: Job) -> Plan:
    return Plan(jobs=[state.spec(JobKind.LINK_CONCEPTS)], status=DocumentStatus.INDEXED)


def _refresh_graph(state: State) -> Effect:
    """Sync the idea graph with the document's effective `concept_links` (§11)."""
    document_id = state.document.id
    return lambda session: graph.refresh_document(session, document_id)


def link_finished(state: State, job: Job) -> Plan:
    """The link job's artifact (unless it waits in `needs_review`) enters the graph."""
    if graph.is_graph_job(job):  # merge and bridge proposals wait for a human; nothing follows
        return Plan()
    return Plan(status=DocumentStatus.LINKED, effects=[_refresh_graph(state)])


def section_approved(state: State, artifact: Artifact) -> Plan:
    """A corrected section note changes the chapter's inputs: re-distil the chapter."""
    return _chapter_if_complete(state, artifact.anchor)


def chapter_approved(state: State, artifact: Artifact) -> Plan:
    return _brief_if_complete(state)


def _auto_derive(document: Document) -> Effect:
    """The study material the settings ask a distilled book to make on its own."""

    def specs(session: Session) -> list[JobSpec]:
        catalogue = load_catalogue(get_settings().skills_dir)
        allowed = app_settings.eligible(catalogue, app_settings.group_of(document.genre))
        chosen = app_settings.stored_auto_derive(session).get("book", [])
        return [
            app_settings.derive_spec(allowed[name], document.id)
            for name in chosen
            if name in allowed
        ]

    return specs


def brief_approved(state: State, artifact: Artifact) -> Plan:
    return Plan(
        jobs=[state.spec(JobKind.EMBED)],
        status=DocumentStatus.DISTILLED,
        effects=[_auto_derive(state.document)],
    )


def guide_approved(state: State, artifact: Artifact) -> Plan:
    """The guide usually lands after the brief's embed ran: re-index an indexed document
    so search sees it. Before that, the brief's own embed picks it up."""
    if _RANK.get(state.document.status, -1) >= _RANK[DocumentStatus.INDEXED]:
        return Plan(jobs=[state.spec(JobKind.EMBED)])
    return Plan()


def links_reviewed(state: State, artifact: Artifact) -> Plan:
    """Approve, edit or reject of a `concept_links`: the graph follows the effective version
    (a rejection falls back to the previous one, or withdraws the document's links)."""
    return Plan(effects=[_refresh_graph(state)])


def element_approved(state: State, artifact: Artifact) -> Plan:
    """An approved (possibly low-confidence) explanation now feeds its section note."""
    node = state.node(artifact.anchor)
    scope = state.tree.scope_of(node) if node is not None else None
    if scope is None:
        return Plan()
    return Plan(jobs=[state.spec(JobKind.DISTIL_SECTION, scope.anchor)])


JobRule = Callable[[State, Job], Plan]
ReviewRule = Callable[[State, Artifact], Plan]

AFTER_JOB: dict[JobKind, JobRule] = {
    JobKind.PARSE: lambda state, job: start_distillation(state),
    **dict.fromkeys(ELEMENT_KINDS, element_finished),
    JobKind.DISTIL_SECTION: section_finished,
    JobKind.DISTIL_CHAPTER: chapter_finished,
    JobKind.BRIEF: brief_finished,
    JobKind.DERIVE: derive_finished,
    JobKind.EMBED: embed_finished,
    JobKind.LINK_CONCEPTS: link_finished,
}
# Failed (or cancelled) jobs only unblock barriers; they never count as the stage's output.
ON_FAILURE = ELEMENT_KINDS

AFTER_APPROVAL: dict[ArtifactType, ReviewRule] = {
    ArtifactType.SECTION_NOTE: section_approved,
    ArtifactType.CHAPTER_DISTILLATION: chapter_approved,
    ArtifactType.BOOK_BRIEF: brief_approved,
    ArtifactType.BOOK_GUIDE: guide_approved,
    ArtifactType.CONCEPT_LINKS: links_reviewed,
    **dict.fromkeys(artifacts.ELEMENT_TYPES, element_approved),
}
AFTER_REJECTION: dict[ArtifactType, ReviewRule] = {
    ArtifactType.CONCEPT_LINKS: links_reviewed,
}


@dataclass(frozen=True, slots=True)
class Rules:
    """A pipeline profile (Papers P2): how a parsed document starts, and the tables.
    `after_reopen` runs when an approved or rejected verdict is undone (`on_reopen`)."""

    start: Callable[[State], Plan]
    after_job: Mapping[JobKind, JobRule]
    after_approval: Mapping[ArtifactType, ReviewRule]
    after_rejection: Mapping[ArtifactType, ReviewRule]
    after_reopen: Mapping[ArtifactType, ReviewRule] = field(default_factory=dict)


BOOK_RULES = Rules(start_distillation, AFTER_JOB, AFTER_APPROVAL, AFTER_REJECTION)


def rules_for(document: Document) -> Rules:
    """The document's profile: a paper's lives in `app.papers.profile`."""
    if document.genre is not Genre.PAPER:
        return BOOK_RULES
    from app.papers.profile import RULES  # lazy: the profile is built on State and Plan

    return RULES


# --- Entry points ---------------------------------------------------------------------


def _state(session: Session, document_id: object) -> State | None:
    document = session.get(Document, document_id)
    if document is None or document.status in BLOCKED:
        return None
    return State(session=session, document=document, tree=Tree.load(session, document))


def _advance(document: Document, target: DocumentStatus) -> bool:
    if _RANK[target] > _RANK.get(document.status, -1):
        document.status = target
        return True
    return False


def _apply(state: State, plan: Plan) -> list[Job]:
    if plan.status is not None and _advance(state.document, plan.status):
        state.session.add(state.document)
        state.session.commit()
    specs = list(plan.jobs)
    for effect in plan.effects:
        specs.extend(effect(state.session))
    queued = [job for spec in specs if (job := queue.enqueue(state.session, spec))]
    if specs or plan.status:
        logger.info(
            "Pipeline advanced",
            extra={
                "document_id": str(state.document.id),
                "status": state.document.status.value,
                "enqueued": [f"{j.kind.value}:{j.anchor or '-'}" for j in queued],
            },
        )
    return queued


def on_job_done(session: Session, job: Job) -> list[Job]:
    """Advance the document after a terminal job. Returns the jobs it enqueued."""
    document = session.get(Document, job.document_id) if job.document_id is not None else None
    rule = rules_for(document).after_job.get(job.kind) if document is not None else None
    # A job cancelled by a person produced nothing: like a failure, it only releases barriers
    # (a cancelled embed must not make the document `indexed`, nor queue linking).
    cancelled = job.state is JobState.SKIPPED and job.error == queue.CANCELLED
    finished = job.state is JobState.DONE or (job.state is JobState.SKIPPED and not cancelled)
    if rule is None:
        return []
    if not finished and not (
        (job.state is JobState.FAILED or cancelled) and job.kind in ON_FAILURE
    ):
        return []
    state = _state(session, job.document_id)
    return _apply(state, rule(state, job)) if state is not None else []


def on_review(session: Session, artifact: Artifact) -> list[Job]:
    """Propagate a review: an approval (approve, edit, or a human-authored artifact) moves
    the pipeline upward (§7); a rejection lets the rules that consumed the artifact undo it."""
    document = session.get(Document, artifact.document_id)
    rules = rules_for(document) if document is not None else BOOK_RULES
    tables = {Review.APPROVED: rules.after_approval, Review.REJECTED: rules.after_rejection}
    rule = tables[artifact.review].get(artifact.type) if artifact.review in tables else None
    if rule is None:
        return []
    state = _state(session, artifact.document_id)
    return _apply(state, rule(state, artifact)) if state is not None else []


def on_reopen(session: Session, artifact: Artifact, *, was_approved: bool) -> list[Job]:
    """A verdict was undone (approved/rejected → draft). Deliberately conservative:

    * nothing built on the approval is withdrawn: a reopened section note keeps its chapter
      distillation, a reopened brief leaves the document `distilled` and its links alone;
    * `concept_links`: the graph follows the effective version, which just changed;
    * an approved, indexed type on an already indexed document queues `embed`, so search
      (approved content only) drops it; its previous approved version, if any, comes back.
    """
    state = _state(session, artifact.document_id)
    if state is None:
        return []
    plan = (
        links_reviewed(state, artifact) if artifact.type is ArtifactType.CONCEPT_LINKS else Plan()
    )
    indexed = _RANK.get(state.document.status, -1) >= _RANK[DocumentStatus.INDEXED]
    if was_approved and indexed and artifact.type in INDEXED_TYPES:
        plan.jobs.append(state.spec(JobKind.EMBED))
    rule = rules_for(state.document).after_reopen.get(artifact.type)
    if rule is not None:  # a profile's own reaction (papers: re-materialize the claims)
        extra = rule(state, artifact)
        plan.jobs.extend(extra.jobs)
        plan.effects.extend(extra.effects)
    return _apply(state, plan)


def on_document_parsed(session: Session, document: Document) -> list[Job]:
    """Start the pipeline for a `parsed` document (e.g. after a human fixed the outline)."""
    state = _state(session, document.id)
    return _apply(state, rules_for(document).start(state)) if state is not None else []

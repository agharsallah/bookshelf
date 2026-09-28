"""The paper profile's graph rules (docs/PAPERS.md §3-§5): linking and the citation graph.

    embed done           → link_paper_concepts (methods, datasets, metrics, tasks), indexed;
                           the embed a graph refresh queues after concepts came or went
                           (`payload.reason = concepts`) only re-runs the semantic pass: it
                           does not re-link, or the skill would re-run on its own concepts.
                           Neither does a re-embed of a paper already linked (approved
                           claims or study sets): the skill's input holds the shelf's live
                           concepts, so it would never be an idempotent hit and every
                           approval would pay a reason-tier run. New content still
                           re-links: a new card re-runs the derives, and their approved
                           results_table re-links (below)
    link_paper_concepts  → the book's `link_finished`: linked, graph refresh (which also
                           re-seeds the paper's cites edges, `papers.cites`)
    results_table approved on an indexed paper → link_paper_concepts again, so the names
                           comparisons join on reach the graph (a no-op when unchanged)
    paper_structure · paper_enrich done → re-seed cites edges: both set
                           `paper_references.target_document_id`

`papers.profile.RULES` merges these into its tables; nothing here changes the book's.
"""

import uuid

from sqlmodel import Session

from app.jobs.queue import JobSpec
from app.models import Artifact, Job
from app.models.enums import DocumentStatus, JobKind
from app.papers import cites
from app.pipeline.orchestrator import _RANK, Effect, JobRule, Plan, State, link_finished

SEMANTIC_REASON = "concepts"  # graph.pipeline.semantic_spec's payload.reason


def embed_finished(state: State, job: Job) -> Plan:
    """A paper is indexed: link it with the paper skill (not link-concepts)."""
    relinks = _RANK.get(state.document.status, -1) < _RANK[DocumentStatus.LINKED]
    if (job.payload or {}).get("reason") == SEMANTIC_REASON or not relinks:
        return Plan(status=DocumentStatus.INDEXED)
    return Plan(jobs=[state.spec(JobKind.LINK_PAPER_CONCEPTS)], status=DocumentStatus.INDEXED)


def results_approved(state: State, artifact: Artifact) -> Plan:
    """Approved results feed link-paper-concepts: re-link a paper that is already indexed."""
    if _RANK.get(state.document.status, -1) < _RANK[DocumentStatus.INDEXED]:
        return Plan()
    return Plan(jobs=[state.spec(JobKind.LINK_PAPER_CONCEPTS)])


def refresh_cites(document_id: uuid.UUID) -> Effect:
    """An effect re-seeding the document's cites edges and those of the papers citing it."""

    def effect(session: Session) -> list[JobSpec]:
        cites.refresh(session, document_id)
        return []

    return effect


def with_cites(rule: JobRule) -> JobRule:
    """`rule`, plus a cites refresh: for jobs that set reference targets."""

    def wrapped(state: State, job: Job) -> Plan:
        plan = rule(state, job)
        plan.effects.append(refresh_cites(state.document.id))
        return plan

    return wrapped


def enrich_finished(state: State, job: Job) -> Plan:
    return Plan(effects=[refresh_cites(state.document.id)])


AFTER_JOB = {
    JobKind.EMBED: embed_finished,
    JobKind.LINK_PAPER_CONCEPTS: link_finished,
    JobKind.PAPER_ENRICH: enrich_finished,
}

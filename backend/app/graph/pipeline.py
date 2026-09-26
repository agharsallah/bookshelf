"""Where the graph meets the pipeline: the orchestrator effect and the dedup job.

    link_concepts job done · concept_links approved / edited / rejected
      → refresh_document: sync the document's effective concept_links (`apply`),
        re-seed its diagram edges and its mention edges (every other document's too
        when concepts came or went), and hand back a dedup job for the concepts it created

Dedup is a job, not inline work: it embeds concepts and calls the model once per
candidate pair, which must never run inside an HTTP request (an approval) or hold up the
worker thread that finished the link job. There is no `dedup` JobKind without a
migration, so it rides on `link_concepts` with `payload.mode = "dedup"` and an
`input_hash` over the concept ids (the live-work dedupe index then keeps it apart from
the document's link job). `app.pipeline.handlers.skills` routes it here.
"""

import uuid
from collections.abc import Sequence
from pathlib import Path

from sqlmodel import Session

from app.core.config import get_settings
from app.graph import apply, diagram_seeds, mentions
from app.graph.dedup import DenseEmbedder, run_dedup
from app.jobs.queue import JobSpec
from app.jobs.registry import HandlerResult, PermanentJobError
from app.models import Document, Job
from app.models.enums import JobKind, JobState
from app.pipeline import ceiling
from app.pipeline.hashing import input_hash
from app.pipeline.runner import ModelRunner

DEDUP_MODE = "dedup"
DEDUP_PRIORITY = 125  # after link_concepts (120): propose merges once the links are in


def is_dedup_job(job: Job) -> bool:
    return job.kind is JobKind.LINK_CONCEPTS and job.payload.get("mode") == DEDUP_MODE


def dedup_spec(document_id: uuid.UUID, concept_ids: Sequence[uuid.UUID]) -> JobSpec | None:
    ids = sorted(str(c) for c in concept_ids)
    if not ids:
        return None
    return JobSpec(
        kind=JobKind.LINK_CONCEPTS,
        document_id=document_id,
        input_hash=input_hash("dedup", "1", {"concepts": ids}),
        payload={"mode": DEDUP_MODE, "concept_ids": ids},
        priority=DEDUP_PRIORITY,
    )


def refresh_document(session: Session, document_id: uuid.UUID) -> list[JobSpec]:
    """Bring the document's slice of the graph up to date. Returns the dedup job to queue."""
    applied = apply.sync_document(session, document_id)
    diagram_seeds.seed_document(session, document_id)
    mentions.seed_document(session, document_id)
    if applied.created or applied.removed:  # other books may name the new concepts
        mentions.seed_all(session, exclude=document_id)
    spec = dedup_spec(document_id, applied.created)
    return [spec] if spec is not None else []


def _concept_ids(job: Job) -> list[uuid.UUID]:
    raw = job.payload.get("concept_ids")
    if not isinstance(raw, list):
        raise PermanentJobError("dedup job needs payload.concept_ids")
    try:
        return [uuid.UUID(str(value)) for value in raw]
    except ValueError as exc:
        raise PermanentJobError(f"payload.concept_ids holds a non-uuid: {exc}") from exc


def run_dedup_job(
    session: Session,
    job: Job,
    *,
    runner: ModelRunner,
    embedder: DenseEmbedder | None = None,
    skills_dir: Path | None = None,
) -> HandlerResult:
    """Handler body: propose merges for the job's concepts; verdicts go to `jobs.result`.

    Each model verdict is a CLI run like any other: counted against the document's run
    ceiling (`app.pipeline.ceiling`), and nothing at all runs for a paused document."""
    from app.pipeline.execution import SKILL_JOB_KINDS  # execution imports the graph

    settings = get_settings()
    document = session.get(Document, job.document_id) if job.document_id else None
    if document is None:
        raise PermanentJobError("dedup jobs need an existing document_id")
    ceiling.refuse_if_paused(session, document)
    runner = ceiling.metered(
        runner, session, job, document, SKILL_JOB_KINDS, settings.max_runs_per_document
    )
    if embedder is None:
        from app.retrieval.embedding import get_embedder  # lazy: loads FastEmbed

        embedder = get_embedder()
    verdicts = run_dedup(
        session,
        _concept_ids(job),
        runner=runner,
        embedder=embedder,
        skills_dir=skills_dir or settings.skills_dir,
        threshold=float(job.payload.get("threshold", settings.concept_dedup_threshold)),
        limit=settings.concept_dedup_max_pairs,
    )
    proposals = [v.as_json() for v in verdicts]
    state = JobState.DONE if verdicts else JobState.SKIPPED
    return HandlerResult(
        state=state,
        result={
            "mode": DEDUP_MODE,
            "proposals": proposals,
            "proposed": sum(1 for v in verdicts if v.same),
        },
    )

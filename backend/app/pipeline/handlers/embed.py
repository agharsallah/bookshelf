"""`embed` job (§7, §10): index a document's blocks and approved artifacts into Qdrant.

With a `document_id`: ensure the collections, then sync that document's points (only
changed or re-modelled points are re-embedded). Without one (`POST /jobs {kind: embed}`):
rebuild the whole index from Postgres, removing documents that no longer exist (D1:
derived stores need a rebuild job from day one). With `payload.purge = <document id>`
(queued when a document is deleted): drop that document's points and nothing else.
`payload.force` re-embeds everything and, on a rebuild, recreates collections whose vector
size no longer fits the model.
"""

from app.jobs.registry import HandlerResult, JobContext, PermanentJobError, handler
from app.models import Document
from app.models.enums import JobKind
from app.retrieval.embedding import get_embedder
from app.services.documents import PURGE


@handler(JobKind.EMBED)
def run_embed(ctx: JobContext) -> HandlerResult:
    """Index one document, or rebuild everything when the job names no document."""
    # Lazy: Qdrant (and with it FastEmbed / onnxruntime) loads only when an embed job runs.
    from app.retrieval import indexing
    from app.retrieval.client import get_client
    from app.retrieval.collections import ensure_ready

    purge = (ctx.job.payload or {}).get(PURGE)
    if ctx.job.document_id is None and isinstance(purge, str):
        indexing.delete_document(get_client(), purge)
        return HandlerResult(result={"purged": purge})
    embedder = get_embedder()
    force = bool((ctx.job.payload or {}).get("force"))
    if ctx.job.document_id is None:
        return HandlerResult(
            result=indexing.rebuild_all(ctx.session, embedder=embedder, force=force)
        )
    document = ctx.session.get(Document, ctx.job.document_id)
    if document is None:
        raise PermanentJobError(f"Embed needs an existing document, got {ctx.job.document_id}.")
    ensure_ready(get_client(), dense_dim=embedder.dense_dim)
    return HandlerResult(
        result=indexing.index_document(ctx.session, document, embedder=embedder, force=force)
    )

"""`export` job (§7 stage 11): write the Markdown, JSON and CSV bundle to `exports/<slug>/`."""

from app.core.config import get_settings
from app.jobs.registry import HandlerResult, JobContext, PermanentJobError, handler
from app.models import Document
from app.models.enums import JobKind
from app.services import exports


@handler(JobKind.EXPORT)
def run_export(ctx: JobContext) -> HandlerResult:
    """Regenerate the document's export bundle from its tree and approved artifacts."""
    document_id = ctx.job.document_id
    document = ctx.session.get(Document, document_id) if document_id else None
    if document is None:
        raise PermanentJobError(f"Export needs an existing document, got {document_id}.")
    settings = get_settings()
    bundle = exports.load_bundle(ctx.session, document)
    paths = exports.write_bundle(bundle, settings.exports_dir, settings.media_dir)
    return HandlerResult(
        result={
            "files": {name: str(path) for name, path in paths.items()},
            "artifacts": len(bundle.artifacts),
        }
    )

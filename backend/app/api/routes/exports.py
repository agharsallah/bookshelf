"""Export bundles, regenerated on demand from the tree and approved artifacts (§16 Q5)."""

from fastapi import APIRouter, Request, Response

from app.api.deps import SessionDep
from app.api.routes.documents import DocumentRef
from app.schemas.export import DocumentExport
from app.services import documents, exports

router = APIRouter(prefix="/exports", tags=["exports"])


def _bundle(session: SessionDep, ref: str) -> exports.ExportBundle:
    return exports.load_bundle(session, documents.get_document(session, ref))


def _inline(filename: str) -> dict[str, str]:
    return {"Content-Disposition": f'inline; filename="{filename}"'}


@router.get(
    "/{ref}.md",
    response_class=Response,
    responses={200: {"content": {"text/markdown": {}}}},
    summary="Markdown bundle: the tree with anchors, plus approved artifacts",
)
def export_markdown(ref: DocumentRef, session: SessionDep, request: Request) -> Response:
    bundle = _bundle(session, ref)
    media_base = request.url_for("get_media", path="").path  # figures link to this API
    return Response(
        exports.to_markdown(bundle, media_base=media_base),
        media_type="text/markdown; charset=utf-8",
        headers=_inline(f"{bundle.document.slug}.md"),
    )


@router.get(
    "/{ref}.json",
    response_model=DocumentExport,
    summary="JSON bundle: tree plus approved artifacts in render-contract JSON",
)
def export_json(ref: DocumentRef, session: SessionDep) -> DocumentExport:
    return exports.to_export(_bundle(session, ref))


@router.get(
    "/{ref}/tables.csv",
    response_class=Response,
    responses={200: {"content": {"text/csv": {}}}},
    summary="Every table node and table/chart block, one row per cell",
)
def export_tables(ref: DocumentRef, session: SessionDep) -> Response:
    bundle = _bundle(session, ref)
    return Response(
        exports.to_csv(bundle),
        media_type="text/csv; charset=utf-8",
        headers=_inline(f"{bundle.document.slug}-tables.csv"),
    )

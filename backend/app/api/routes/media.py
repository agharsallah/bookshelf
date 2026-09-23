"""Figure crops and rendered pages from `settings.media_dir`."""

from typing import Annotated

from fastapi import APIRouter
from fastapi import Path as PathParam
from fastapi.responses import FileResponse

from app.api.routes.library import SettingsDep
from app.services.media import IMAGE_TYPES, resolve_media_file

router = APIRouter(prefix="/media", tags=["media"])

MEDIA_HEADERS = {
    # Crops are derived and rarely change; ETag/Last-Modified still revalidate a re-parse.
    "Cache-Control": "public, max-age=31536000",
    # The reader runs on another origin: allow embedding even under COEP.
    "Cross-Origin-Resource-Policy": "cross-origin",
    # The global `default-src 'none'` would also block the image when opened directly in a
    # tab (the browser's image document is subject to it); allow only the image itself.
    "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; "
    "sandbox",
}


@router.get(
    "/{path:path}",
    response_class=FileResponse,
    responses={200: {"content": {t: {} for t in sorted(set(IMAGE_TYPES.values()))}}},
    summary="Serve a derived image (figure crop)",
)
def get_media(
    path: Annotated[str, PathParam(max_length=512)], settings: SettingsDep
) -> FileResponse:
    file, media_type = resolve_media_file(settings.media_dir, path)
    return FileResponse(file, media_type=media_type, headers=MEDIA_HEADERS)

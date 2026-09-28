"""`library/` files waiting to be ingested (§13 `GET /library`)."""

from fastapi import APIRouter

from app.api.deps import LimitDep, OffsetDep, SessionDep, SettingsDep
from app.schemas.common import Page
from app.schemas.document import LibraryFilePublic
from app.services import library

router = APIRouter(prefix="/library", tags=["library"])


@router.get(
    "",
    response_model=Page[LibraryFilePublic],
    summary="List library files not yet ingested",
    description=(
        "Supported files (`.pdf .epub .html .htm .md`) under `library/`, recursively, whose "
        "sha256 matches no document. Hashes are cached by path, size and mtime."
    ),
)
def list_library(
    session: SessionDep, settings: SettingsDep, limit: LimitDep = 50, offset: OffsetDep = 0
) -> Page[LibraryFilePublic]:
    files = library.pending_files(session, settings.library_dir)
    return Page(
        items=[LibraryFilePublic.model_validate(f) for f in files[offset : offset + limit]],
        total=len(files),
        limit=limit,
        offset=offset,
    )

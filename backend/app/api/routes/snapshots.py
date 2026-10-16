"""Settings → Database → Snapshot: the whole shelf (rows, originals, media, audio) as one
file, to download here and restore on another install (`app/services/snapshots.py`).

Downloading is a `POST`, like every other route here: a snapshot holds everything, so it
sits behind the API key, and the browser's same-origin proxy adds the key to writes only.
A plain form post downloads the file without leaving the page.
"""

from functools import lru_cache
from typing import Annotated

import anyio
from fastapi import APIRouter, Depends, Query, Request, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse

from app.core.config import get_settings
from app.core.security import require_api_key
from app.schemas.snapshots import SnapshotProgress, SnapshotStatus
from app.services.exclusive import process_wide
from app.services.snapshots import SnapshotService

PREFIX = "/database/snapshot"
UPLOAD_PATH = f"{PREFIX}/restore"  # its body cap is `snapshot_max_bytes` (app.main)

router = APIRouter(prefix=PREFIX, tags=["database"])


@lru_cache
def _service() -> SnapshotService:
    return SnapshotService(get_settings(), exclusive=process_wide())


def get_snapshot_service(request: Request) -> SnapshotService:
    """One service per process (it holds the progress), pausing the runners of the app
    that serves the request while a restore writes."""
    service = _service()
    service.bind_runners(lambda: getattr(request.app.state, "runners", None))
    return service


ServiceDep = Annotated[SnapshotService, Depends(get_snapshot_service)]


@router.get(
    "",
    response_model=SnapshotStatus,
    summary="The last snapshot and the one being made or restored",
    description="Poll it while `progress.state` is `running`.",
)
def get_status(service: ServiceDep) -> SnapshotStatus:
    return service.status()


@router.post(
    "",
    response_model=SnapshotProgress,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(require_api_key)],
    summary="Make a snapshot",
    description="Packs every row of the database in use, with `library/`, the media and "
    "the audio, into one `.tar.gz`, in the background; it replaces the last one. The search "
    "index is left out: a restore rebuilds it. `409` while a sync, snapshot or restore runs.",
)
def make_snapshot(service: ServiceDep) -> SnapshotProgress:
    return service.start_export()


@router.post(
    "/download",
    response_class=FileResponse,
    dependencies=[Depends(require_api_key)],
    responses={200: {"content": {"application/gzip": {}}}},
    summary="Download the last snapshot",
    description="`404` when none has been made here.",
)
def download_snapshot(service: ServiceDep) -> FileResponse:
    path = service.download()
    return FileResponse(path, media_type="application/gzip", filename=path.name)


@router.post(
    "/restore",
    response_model=SnapshotProgress,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(require_api_key)],
    summary="Restore a snapshot over everything here",
    description="The request body is the snapshot file itself (`application/gzip`), "
    "streamed to disk. Then, in the background: unpack it, check its schema, back up the "
    "database (`backup`, pg_dump), replace every row in one transaction, move its folders "
    "in place of the current ones (kept under `before-restore/`) and queue an `embed` "
    "rebuild. `409` before any upload when a sync, snapshot, restore or job is running.",
)
async def restore_snapshot(
    request: Request,
    service: ServiceDep,
    backup: Annotated[bool, Query(description="Back up the database before replacing it.")] = True,
) -> SnapshotProgress:
    upload = await run_in_threadpool(service.begin_restore, backup=backup)
    try:
        async with await anyio.open_file(upload, "wb") as out:
            async for chunk in request.stream():
                await out.write(chunk)
    except BaseException:
        service.abandon_restore(upload)
        raise
    return service.start_restore(upload, backup=backup)

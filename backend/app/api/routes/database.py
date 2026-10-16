"""Settings → Database: which database the app uses, and syncing one into the other."""

from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, Request, status

from app.core.config import get_settings
from app.core.security import require_api_key
from app.schemas.database import DatabaseStatus, SwitchRequest, SyncProgress, SyncRequest
from app.services.database import DatabaseService
from app.services.exclusive import process_wide

router = APIRouter(prefix="/database", tags=["database"])


@lru_cache
def _service() -> DatabaseService:
    return DatabaseService(get_settings(), exclusive=process_wide())


def get_database_service(request: Request) -> DatabaseService:
    """One service per process (it holds the sync's progress), stopping and starting the
    runners of the app that serves the request."""
    service = _service()
    service.bind_runners(lambda: getattr(request.app.state, "runners", None))
    return service


ServiceDep = Annotated[DatabaseService, Depends(get_database_service)]


@router.get(
    "",
    response_model=DatabaseStatus,
    summary="Both databases and the sync",
    description="Reaches both databases (in parallel) for a few headline counts, says which "
    "one the app uses and what (if anything) stops a sync, and reports the last or current "
    "sync. Poll it while `sync.state` is `running`.",
)
def get_status(service: ServiceDep) -> DatabaseStatus:
    return service.status()


@router.put(
    "/active",
    response_model=DatabaseStatus,
    dependencies=[Depends(require_api_key)],
    summary="Read and write the other database",
    description="Running jobs go back to the queue of the database they came from; the "
    "API's workers then claim from the new one. `409` when only one database is configured, "
    "a sync is running, either cannot be reached, or their schemas differ.",
)
def switch(body: SwitchRequest, service: ServiceDep) -> DatabaseStatus:
    return service.switch(body.target)


@router.post(
    "/sync",
    response_model=SyncProgress,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(require_api_key)],
    summary="Copy one database over the other",
    description="Replaces every row of the other database with `source`'s, in one "
    "transaction (all or nothing), after a `pg_dump` backup of it when `backup` is true. "
    "Runs in the background: poll `GET /database`. `409` when it cannot start (see switch, "
    "plus jobs running on either side).",
)
def start_sync(body: SyncRequest, service: ServiceDep) -> SyncProgress:
    return service.start_sync(body.source, backup=body.backup)

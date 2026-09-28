"""Attention reports: the browser's attention clock, flushed in batches."""

from fastapi import APIRouter, Depends

from app.api.deps import SessionDep
from app.core.security import require_api_key
from app.schemas.activity import ActivityBatch, ActivityRecorded
from app.services import activity

router = APIRouter(prefix="/activity", tags=["activity"])


@router.post(
    "",
    response_model=ActivityRecorded,
    dependencies=[Depends(require_api_key)],
    summary="Report seconds of attention",
    description="Adds each entry's seconds to its minute, surface and place (a row never "
    "exceeds 60 s). Entries naming a document that no longer exists are dropped; an `at` "
    "older than 7 days or in the future is a `422`.",
)
def report_activity(body: ActivityBatch, session: SessionDep) -> ActivityRecorded:
    reports = [activity.Report(**entry.model_dump()) for entry in body.entries]
    return ActivityRecorded(recorded=activity.record(session, reports))

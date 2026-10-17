"""Pills (docs/PILLS.md §7): a vertical feed of one-idea, cited learning cards.

Pills are derived (D1): harvested from the shelf's artifacts by `harvest_pills` jobs, which
run on their own whenever a harvestable artifact is stored or reviewed. `POST /pills/rebuild`
queues them by hand (one document, or the backfill of every document).

Fixed paths (`/pills/rebuild`, the feed endpoints) are declared before `/pills/{pill_id}`.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status

from app.api.deps import SessionDep
from app.core.errors import NotFoundError
from app.core.security import require_api_key
from app.models.pill import Pill, PillSession
from app.pills import events, feeds, generate, serialize, supply, triggers
from app.pills.contract import PillOut
from app.pills.feed import scope, sessions, summary
from app.pills.feed.config import FeedConfig, parse_config
from app.schemas.pills import (
    MAX_EVENTS,
    EventsRequest,
    EventsResult,
    FeedCreate,
    FeedList,
    FeedOut,
    FeedPatch,
    Finished,
    GenerateRequest,
    GenerateResult,
    JobsQueued,
    RebuildRequest,
    SessionContinuation,
    SessionOut,
    SessionPage,
    SessionStart,
    StartRequest,
    Supply,
)
from app.services.documents import get_document
from app.services.errors import InvalidInputError

router = APIRouter(prefix="/pills", tags=["pills"])

WRITE = [Depends(require_api_key)]


# --- Harvest -----------------------------------------------------------------------------


@router.post(
    "/rebuild",
    response_model=JobsQueued,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(require_api_key)],
    summary="Harvest pills again",
    description="Queues a `harvest_pills` job for `document` (uuid or slug), or for every "
    "unarchived document when it is omitted. A harvest already queued is reused.",
)
def rebuild(body: RebuildRequest, session: SessionDep) -> JobsQueued:
    document_id = get_document(session, body.document).id if body.document else None
    return JobsQueued(jobs=[job.id for job in triggers.rebuild(session, document_id)])


# --- Feed (sessions, events, supply, generate, saved feeds) ---------------------------------
# Feed endpoints go here, above `/{pill_id}`, so their fixed paths are matched first.


def _session_out(row: PillSession) -> SessionOut:
    return SessionOut(
        id=row.id,
        config=sessions.config_of(row),
        seed=row.seed,
        position=row.position,
        created_at=row.created_at,
        finished_at=row.finished_at,
    )


@router.post(
    "/sessions",
    response_model=SessionStart,
    status_code=status.HTTP_201_CREATED,
    dependencies=WRITE,
    summary="Start a feed session",
    description="From a `config` or a saved feed (`feed_id`). Returns the session, its first "
    "page and the scope's supply; `notice` says why the feed differs from the config "
    "(`nothing read yet`: consolidate fell back to explore). An unknown source is a `404`.",
)
def start_session(body: StartRequest, session: SessionDep) -> SessionStart:
    config = body.config
    if config is None and body.feed_id is not None:
        config = feeds.get_feed_config(session, body.feed_id)
    row, first = sessions.create(session, config or FeedConfig())
    return SessionStart(
        session=_session_out(row),
        page=SessionPage(pills=first.pills, next_cursor=first.next_cursor),
        supply=first.supply,
        notice=first.notice,
    )


@router.get(
    "/sessions/{session_id}",
    response_model=SessionContinuation,
    summary="A page of a session",
    description="`limit` pills from `cursor` (a page's `next_cursor`); without one, from where "
    "the session was left (its `seen` events). The same cursor serves the same pills. "
    "`done` once the session's length is reached or nothing is left.",
)
def session_page(
    session_id: uuid.UUID,
    session: SessionDep,
    cursor: Annotated[str | None, Query(max_length=20)] = None,
    limit: Annotated[int, Query(ge=1, le=50)] = sessions.PAGE_LIMIT,
) -> SessionContinuation:
    page = sessions.page(session, session_id, cursor=cursor, limit=limit)
    return SessionContinuation(
        pills=page.pills,
        next_cursor=page.next_cursor,
        supply=page.supply,
        done=page.done,
        notice=page.notice,
    )


@router.post(
    "/sessions/{session_id}/finish",
    response_model=Finished,
    dependencies=WRITE,
    summary="End a session",
    description="Closes the session and sums it up from its events: seen, saved, answered, "
    "correct, reviews due within a day, minutes, and where to continue reading.",
)
def finish_session(session_id: uuid.UUID, session: SessionDep) -> Finished:
    return Finished(summary=summary.finish(session, session_id))


@router.post(
    "/events",
    response_model=EventsResult,
    dependencies=WRITE,
    summary="Record feed events",
    description=f"Up to {MAX_EVENTS} events with client ids: a retried id counts in "
    "`duplicates`, never an error; an event on a pill or review item that is gone counts in "
    "`ignored`. A save (or a wrong quiz/flip answer) queues the pill for review; an `answer` "
    "on a review pill is only recorded (rate it through `POST /reviews/{id}/rating`).",
)
def record_events(body: EventsRequest, session: SessionDep) -> EventsResult:
    result = events.ingest(session, body.events)
    return EventsResult(
        accepted=result.accepted, duplicates=result.duplicates, ignored=result.ignored
    )


@router.get(
    "/supply",
    response_model=Supply,
    summary="Pills left in a feed",
    description="Unseen pills in the scope of `config` (a FeedConfig as JSON; omitted: the "
    "default feed), per document with the chapters make-pills could still run on.",
)
def get_supply(
    session: SessionDep, config: Annotated[str | None, Query(max_length=8000)] = None
) -> Supply:
    return supply.compute(session, scope.resolve(session, parse_config(config)))


@router.get(
    "/compose",
    response_model=SessionContinuation,
    summary="A page of a session nobody stores",
    description="For a read-only deployment (the demo), which keeps the session in the "
    "browser: the `limit` pills that follow `served` (comma-separated ids, in order) in the "
    "feed of `config` (a FeedConfig as JSON) with `seed`. Writes nothing. `next_cursor` is "
    "how many will have been served; null once the length is reached or the scope ran dry.",
)
def compose_page(
    session: SessionDep,
    seed: Annotated[int, Query(ge=0, lt=2**31)],
    config: Annotated[str | None, Query(max_length=8000)] = None,
    served: Annotated[str, Query(max_length=8000)] = "",
    limit: Annotated[int, Query(ge=1, le=50)] = sessions.PAGE_LIMIT,
) -> SessionContinuation:
    try:
        ids = [uuid.UUID(part) for part in served.split(",") if part.strip()]
    except ValueError as exc:
        raise InvalidInputError(
            "`served` is comma-separated pill ids.", field="query.served"
        ) from exc
    page = sessions.compose(session, parse_config(config), seed=seed, served=ids, limit=limit)
    return SessionContinuation(
        pills=page.pills,
        next_cursor=page.next_cursor,
        supply=page.supply,
        done=page.done,
        notice=page.notice,
    )


@router.post(
    "/generate",
    response_model=GenerateResult,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=WRITE,
    summary="Make pills for chapters",
    description="Queues make-pills for `anchors` (each needs a chapter distillation), else "
    "for every chapter of `document` that has one and no pills composed yet. Returns the "
    "jobs and a token estimate (null without history).",
)
def generate_pills(body: GenerateRequest, session: SessionDep) -> GenerateResult:
    jobs, estimate = generate.enqueue(session, body.document, body.anchors, body.style)
    return GenerateResult(jobs=jobs, estimate_tokens=estimate)


@router.get("/feeds", response_model=FeedList, summary="Saved feeds")
def list_feeds(session: SessionDep) -> FeedList:
    return FeedList(items=[FeedOut.model_validate(f) for f in feeds.list_feeds(session)])


@router.post(
    "/feeds",
    response_model=FeedOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=WRITE,
    summary="Save a feed",
)
def create_feed(body: FeedCreate, session: SessionDep) -> FeedOut:
    return FeedOut.model_validate(feeds.create_feed(session, body.name, body.config))


@router.patch(
    "/feeds/{feed_id}", response_model=FeedOut, dependencies=WRITE, summary="Rename or reconfigure"
)
def update_feed(feed_id: uuid.UUID, body: FeedPatch, session: SessionDep) -> FeedOut:
    return FeedOut.model_validate(
        feeds.update_feed(session, feed_id, name=body.name, config=body.config)
    )


@router.delete(
    "/feeds/{feed_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=WRITE,
    summary="Delete a saved feed",
)
def delete_feed(feed_id: uuid.UUID, session: SessionDep) -> Response:
    feeds.delete_feed(session, feed_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- One pill ----------------------------------------------------------------------------


@router.get(
    "/{pill_id}",
    response_model=PillOut,
    summary="One pill",
    description="A pill on the wire (contracts/pill.schema.json), retired ones included: "
    "events and sessions keep pointing at them.",
)
def get_pill(pill_id: uuid.UUID, session: SessionDep) -> PillOut:
    row = session.get(Pill, pill_id)
    if row is None:
        raise NotFoundError(f"Pill {pill_id} does not exist.")
    return serialize.serialize(session, [row])[0]

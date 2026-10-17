"""Feed sessions (docs/PILLS.md §6): create, page, resume, finish.

A session stores its `config`, a `seed` and `served`, the ids served so far in order (pill
ids; a review pill's review item id). A page is a slice of `served` from a cursor (the
opaque `next_cursor` is that index); when the slice runs past the end, the session is
extended by ranking (`rank`, seeded by `seed + len(served)`) and mixing (`mixer`) the
candidates it has not served yet, so a page re-read is the same page and a session
resumes on any client. With no cursor, a page starts at `position`, which `seen` events
advance (`app.pills.events`). A session is `done` once `length` pills were served, or when
nothing is left to serve.

A page also reports the scope's supply; when it is low, `generate.top_up` queues
make-pills (lazily, within its own budget).

`compose` is the same engine for a session nobody stores: a read-only deployment (the
demo) keeps `seed` and `served` in the browser and asks for what follows. It writes
nothing, so it never tops up the supply either.
"""

import secrets
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime

from sqlmodel import Session, select

from app.core.errors import NotFoundError
from app.models._columns import utcnow
from app.models.pill import PillSession
from app.pills import generate, supply
from app.pills.contract import PillOut
from app.pills.feed import candidates, history, mixer, rank
from app.pills.feed.config import FeedConfig, FeedMode
from app.pills.feed.rank import Bucket, Ranked
from app.pills.feed.render import render
from app.pills.feed.scope import Scope, resolve
from app.schemas.pills import Supply
from app.services.errors import InvalidInputError

PAGE_LIMIT = 10
BATCH = 20  # the fewest pills a session is extended by
POOL_PER_BUCKET = 300  # best-ranked candidates per bucket the mixer considers

TARGETS: Mapping[FeedMode, Mapping[Bucket, float]] = {
    FeedMode.CONSOLIDATE: {Bucket.MAIN: 0.7, Bucket.REVIEW: 0.2, Bucket.CONNECTION: 0.1},
    FeedMode.EXPLORE: mixer.TARGETS,
    FeedMode.PREVIEW: {Bucket.MAIN: 1.0},
    FeedMode.REVIEW: {Bucket.REVIEW: 1.0},
}


@dataclass(slots=True)
class Page:
    pills: list[PillOut]
    next_cursor: str | None
    supply: Supply
    notice: str | None

    @property
    def done(self) -> bool:
        return self.next_cursor is None


def get_session(session: Session, session_id: uuid.UUID, *, lock: bool = False) -> PillSession:
    query = select(PillSession).where(PillSession.id == session_id)
    row = session.exec(query.with_for_update() if lock else query).first()
    if row is None:
        raise NotFoundError(f"Pill session {session_id} does not exist.")
    return row


def config_of(row: PillSession) -> FeedConfig:
    return FeedConfig.model_validate(row.config)


def _cursor(raw: str) -> int:
    if not raw.isdigit():
        raise InvalidInputError("Not a cursor of this session.", field="query.cursor")
    return int(raw)


def _trim(ranked: list[Ranked]) -> list[Ranked]:
    kept: dict[Bucket, int] = {}
    out = []
    for entry in ranked:
        n = kept.get(entry.candidate.bucket, 0)
        if n < POOL_PER_BUCKET:
            kept[entry.candidate.bucket] = n + 1
            out.append(entry)
    return out


def _following(
    session: Session, scope: Scope, served: list[uuid.UUID], seed: int, upto: int, now: datetime
) -> list[uuid.UUID]:
    """What to serve after `served` so it reaches `upto` (fewer when the scope runs dry)."""
    pool = candidates.load(session, scope, now, exclude=served)
    if not pool:
        return []
    signals = history.kind_signals(session, now=now)
    ranked = _trim(rank.rank(pool, seed=seed + len(served), signals=signals))
    picked = mixer.mix(
        ranked,
        max(upto - len(served), BATCH),
        history=candidates.served(session, scope, served),
        targets=TARGETS[scope.mode],
    )
    length = scope.config.length
    if length is not None:
        picked = picked[: max(length - len(served), 0)]
    return [c.id for c in picked]


def _extend(session: Session, row: PillSession, scope: Scope, upto: int, now: datetime) -> None:
    """Serve more, so that `served` reaches `upto` (fewer when the scope runs dry)."""
    served = list(row.served)
    more = _following(session, scope, served, row.seed, upto, now)
    if more:
        row.served = served + more
        session.add(row)


def _supply(session: Session, scope: Scope) -> Supply:
    """The scope's supply; a low one asks `generate` to top it up."""
    out = supply.compute(session, scope)
    if out.low and scope.mode is not FeedMode.REVIEW:
        generate.top_up(session, list(scope.documents), out.unseen)
    return out


def page(
    session: Session,
    session_id: uuid.UUID,
    *,
    cursor: str | None = None,
    limit: int = PAGE_LIMIT,
    now: datetime | None = None,
) -> Page:
    """`limit` pills from `cursor` (the saved position without one). Commits."""
    when = now or utcnow()
    row = get_session(session, session_id, lock=True)
    scope = resolve(session, config_of(row))
    start = _cursor(cursor) if cursor is not None else row.position
    length = scope.config.length
    end = start + limit if length is None else min(start + limit, length)
    if end > len(row.served):
        _extend(session, row, scope, end, when)
    served = list(row.served)
    session.commit()
    ids = served[start:end]
    reached = start + len(ids)
    ran_dry = len(served) < end
    finished = length is not None and reached >= length
    more = not finished and (reached < len(served) or (not ran_dry and bool(ids)))
    return Page(
        pills=render(session, ids),
        next_cursor=str(reached) if more else None,
        supply=_supply(session, scope),
        notice=scope.notice,
    )


def create(
    session: Session, config: FeedConfig, *, seed: int | None = None, now: datetime | None = None
) -> tuple[PillSession, Page]:
    """A new session and its first page. Commits."""
    resolve(session, config)  # unknown sources: 404 before anything is stored
    row = PillSession(
        config=config.as_json(), seed=secrets.randbelow(2**31) if seed is None else seed
    )
    session.add(row)
    session.commit()
    first = page(session, row.id, cursor="0", now=now)
    session.refresh(row)
    return row, first


def compose(
    session: Session,
    config: FeedConfig,
    *,
    seed: int,
    served: list[uuid.UUID],
    limit: int = PAGE_LIMIT,
    now: datetime | None = None,
) -> Page:
    """The `limit` pills that follow `served` in a session nobody stores. Writes nothing:
    `next_cursor` is how many the session will have served, the next call's `served`."""
    scope = resolve(session, config)
    length = scope.config.length
    start = len(served)
    end = start + limit if length is None else min(start + limit, length)
    ids = _following(session, scope, served, seed, end, now or utcnow())[: end - start]
    reached = start + len(ids)
    finished = length is not None and reached >= length
    more = not finished and len(ids) == end - start and bool(ids)
    return Page(
        pills=render(session, ids),
        next_cursor=str(reached) if more else None,
        supply=supply.compute(session, scope),
        notice=scope.notice,
    )

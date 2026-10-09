"""Saved feeds (docs/PILLS.md §7): a named `FeedConfig`, shown as a chip on the feed."""

import uuid
from collections.abc import Sequence

from sqlmodel import Session, col, select

from app.core.errors import NotFoundError
from app.models._columns import utcnow
from app.models.pill import Feed
from app.pills.feed.config import FeedConfig


def list_feeds(session: Session) -> Sequence[Feed]:
    """Every saved feed, oldest first (the order chips were added in)."""
    return session.exec(select(Feed).order_by(col(Feed.created_at), col(Feed.id))).all()


def get_feed(session: Session, feed_id: uuid.UUID) -> Feed:
    feed = session.get(Feed, feed_id)
    if feed is None:
        raise NotFoundError(f"Feed {feed_id} does not exist.")
    return feed


def get_feed_config(session: Session, feed_id: uuid.UUID) -> FeedConfig:
    return FeedConfig.model_validate(get_feed(session, feed_id).config)


def create_feed(session: Session, name: str, config: FeedConfig) -> Feed:
    """Commits."""
    feed = Feed(name=name.strip(), config=config.as_json())
    session.add(feed)
    session.commit()
    session.refresh(feed)
    return feed


def update_feed(
    session: Session,
    feed_id: uuid.UUID,
    *,
    name: str | None = None,
    config: FeedConfig | None = None,
) -> Feed:
    """Rename and/or reconfigure. Commits."""
    feed = get_feed(session, feed_id)
    if name is not None:
        feed.name = name.strip()
    if config is not None:
        feed.config = config.as_json()
    feed.updated_at = utcnow()
    session.add(feed)
    session.commit()
    session.refresh(feed)
    return feed


def delete_feed(session: Session, feed_id: uuid.UUID) -> None:
    """Commits. Sessions started from it keep their own copy of the config."""
    session.delete(get_feed(session, feed_id))
    session.commit()

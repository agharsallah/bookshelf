"""Collections behind `/collections`: a named, ordered group of documents of any genre
(books, papers, articles) gathered by hand around one topic.

Members live in `collection_members` with a dense `position` (0..n-1) kept dense on every
add, remove and reorder. A document can sit in many collections. Other views (library,
atlas, concepts, neighborhoods) scope themselves to a collection through `document_ids`.
"""

import uuid
from collections import defaultdict
from typing import Any

from sqlmodel import Session, col, func, select

from app.core.errors import NotFoundError
from app.models import Collection, CollectionMember, Document
from app.models._columns import utcnow
from app.services.errors import InvalidInputError
from app.services.library import free_slug, slugify


def get_collection(session: Session, ref: str) -> Collection:
    """Look a collection up by uuid or by slug."""
    collection: Collection | None
    try:
        collection = session.get(Collection, uuid.UUID(ref))
    except ValueError:
        collection = session.exec(select(Collection).where(Collection.slug == ref)).first()
    if collection is None:
        raise NotFoundError(f"Collection {ref} does not exist.")
    return collection


def document_ids(session: Session, collection_id: uuid.UUID) -> list[uuid.UUID]:
    """Members in reading order."""
    return list(
        session.exec(
            select(CollectionMember.document_id)
            .where(CollectionMember.collection_id == collection_id)
            .order_by(col(CollectionMember.position))
        )
    )


def scope(session: Session, ref: str | None) -> list[uuid.UUID] | None:
    """The member ids a `?collection=` filter narrows a view to; `None` when unscoped."""
    return None if ref is None else document_ids(session, get_collection(session, ref).id)


def members(session: Session, collection_id: uuid.UUID) -> list[CollectionMember]:
    return list(
        session.exec(
            select(CollectionMember)
            .where(CollectionMember.collection_id == collection_id)
            .order_by(col(CollectionMember.position))
        )
    )


def members_with_documents(
    session: Session, collection_id: uuid.UUID
) -> list[tuple[CollectionMember, Document]]:
    """Members in reading order, each with its document, in one query."""
    rows = session.exec(
        select(CollectionMember, Document)
        .join(Document, col(Document.id) == CollectionMember.document_id)
        .where(CollectionMember.collection_id == collection_id)
        .order_by(col(CollectionMember.position))
    )
    return [(m, d) for m, d in rows]


def list_collections(
    session: Session, *, document_id: uuid.UUID | None = None
) -> list[tuple[Collection, list[uuid.UUID]]]:
    """Every collection by name with its member ids, or only those holding `document_id`."""
    query = select(Collection).order_by(func.lower(Collection.name), col(Collection.id))
    if document_id is not None:
        holding = select(CollectionMember.collection_id).where(
            CollectionMember.document_id == document_id
        )
        query = query.where(col(Collection.id).in_(holding))
    rows = list(session.exec(query))
    ids: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    for member in session.exec(
        select(CollectionMember)
        .where(col(CollectionMember.collection_id).in_([c.id for c in rows]))
        .order_by(col(CollectionMember.position))
    ):
        ids[member.collection_id].append(member.document_id)
    return [(c, ids[c.id]) for c in rows]


def _unique_slug(session: Session, name: str) -> str:
    base = slugify(name)
    if base == "document":  # slugify's fallback for names with no ASCII letters
        base = "collection"
    taken = set(
        session.exec(
            select(Collection.slug).where(
                (col(Collection.slug) == base) | col(Collection.slug).like(f"{base}-%")
            )
        )
    )
    return free_slug(base, taken.__contains__)


def _check_documents(session: Session, ids: list[uuid.UUID], field: str) -> None:
    found = set(session.exec(select(Document.id).where(col(Document.id).in_(ids))))
    if missing := [str(i) for i in ids if i not in found]:
        raise InvalidInputError(f"Not on the shelf: {', '.join(missing)}.", field=field)


def create_collection(
    session: Session,
    *,
    name: str,
    description: str | None = None,
    colour: str | None = None,
    document_ids: list[uuid.UUID] | None = None,
) -> Collection:
    """A new collection with its first members in the given order (duplicates dropped).
    Commits."""
    ids = list(dict.fromkeys(document_ids or []))
    _check_documents(session, ids, "body.document_ids")
    collection = Collection(
        slug=_unique_slug(session, name), name=name, description=description, colour=colour
    )
    session.add(collection)
    session.flush()
    session.add_all(
        CollectionMember(collection_id=collection.id, document_id=d, position=i)
        for i, d in enumerate(ids)
    )
    session.commit()
    session.refresh(collection)
    return collection


def update_collection(session: Session, ref: str, changes: dict[str, Any]) -> Collection:
    """Apply the sent fields (`name`, `description`, `colour`). Commits."""
    collection = get_collection(session, ref)
    if changes.get("name") is None:
        changes.pop("name", None)  # a name cannot be cleared
    for key, value in changes.items():
        setattr(collection, key, value)
    collection.updated_at = utcnow()
    session.add(collection)
    session.commit()
    session.refresh(collection)
    return collection


def delete_collection(session: Session, ref: str) -> None:
    """Deletes the collection and its memberships; the documents stay. A missing one is
    fine."""
    try:
        collection = get_collection(session, ref)
    except NotFoundError:
        return
    session.delete(collection)
    session.commit()


def _touch(session: Session, collection: Collection) -> None:
    collection.updated_at = utcnow()
    session.add(collection)


def put_member(
    session: Session, ref: str, document_id: uuid.UUID, *, note: str | None, set_note: bool
) -> CollectionMember:
    """Add a document at the end, or (already a member) update its note when `set_note`.
    Commits."""
    collection = get_collection(session, ref)
    _check_documents(session, [document_id], "document_id")
    member = session.get(CollectionMember, (collection.id, document_id))
    if member is None:
        count = session.exec(
            select(func.count())
            .select_from(CollectionMember)
            .where(CollectionMember.collection_id == collection.id)
        ).one()
        member = CollectionMember(
            collection_id=collection.id, document_id=document_id, position=int(count), note=note
        )
    elif set_note:
        member.note = note
    session.add(member)
    _touch(session, collection)
    session.commit()
    session.refresh(member)
    return member


def _renumber(session: Session, rows: list[CollectionMember]) -> None:
    for position, member in enumerate(rows):
        if member.position != position:
            member.position = position
            session.add(member)


def remove_member(session: Session, ref: str, document_id: uuid.UUID) -> None:
    """Drop a document from the collection and close the gap; not a member is fine.
    Commits."""
    collection = get_collection(session, ref)
    member = session.get(CollectionMember, (collection.id, document_id))
    if member is None:
        return
    session.delete(member)
    session.flush()
    _renumber(session, members(session, collection.id))
    _touch(session, collection)
    session.commit()


def reorder(session: Session, ref: str, order: list[uuid.UUID]) -> Collection:
    """Put the members in `order`, which must name every member exactly once. Commits."""
    collection = get_collection(session, ref)
    rows = {m.document_id: m for m in members(session, collection.id)}
    if len(order) != len(set(order)) or set(order) != set(rows):
        raise InvalidInputError(
            "The order must name every member of the collection exactly once.",
            field="body.document_ids",
        )
    _renumber(session, [rows[d] for d in order])
    _touch(session, collection)
    session.commit()
    session.refresh(collection)
    return collection

"""Collections: hand-gathered groups of books, papers and articles around one topic.

A collection is addressed by id or slug. Members keep a reading order and a note. Other
endpoints take `?collection=<ref>` to narrow themselves to its members: `GET /documents`,
`GET /graph/atlas`, `GET /graph/neighborhood` and `GET /concepts`.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status

from app.api.deps import SessionDep
from app.core.security import require_api_key
from app.models import Collection
from app.schemas.collections import (
    CollectionCreate,
    CollectionDetail,
    CollectionMemberDetail,
    CollectionMemberPublic,
    CollectionOrder,
    CollectionPublic,
    CollectionUpdate,
    MemberPut,
)
from app.schemas.document import DocumentSummary
from app.services import collections, documents

router = APIRouter(prefix="/collections", tags=["collections"])

WRITE = [Depends(require_api_key)]


def _public(session: SessionDep, collection: Collection) -> CollectionPublic:
    return CollectionPublic(
        **collection.model_dump(), document_ids=collections.document_ids(session, collection.id)
    )


@router.post(
    "",
    response_model=CollectionPublic,
    status_code=status.HTTP_201_CREATED,
    dependencies=WRITE,
    summary="Start a collection",
    description="`document_ids` (optional) are the first members in reading order, "
    "duplicates dropped; any genre. An id not on the shelf is a `422`.",
)
def create_collection(body: CollectionCreate, session: SessionDep) -> CollectionPublic:
    collection = collections.create_collection(
        session,
        name=body.name,
        description=body.description,
        colour=body.colour,
        document_ids=body.document_ids,
    )
    return _public(session, collection)


@router.get(
    "",
    response_model=list[CollectionPublic],
    summary="Every collection, by name",
    description="With `document_id`: only the collections that hold that document.",
)
def list_collections(
    session: SessionDep, document_id: Annotated[uuid.UUID | None, Query()] = None
) -> list[CollectionPublic]:
    return [
        CollectionPublic(**c.model_dump(), document_ids=ids)
        for c, ids in collections.list_collections(session, document_id=document_id)
    ]


@router.get(
    "/{ref}",
    response_model=CollectionDetail,
    summary="A collection with its members",
    description="`members` carry the library row of each document, in reading order.",
)
def get_collection(ref: str, session: SessionDep) -> CollectionDetail:
    collection = collections.get_collection(session, ref)
    rows = collections.members_with_documents(session, collection.id)
    stats = documents.document_stats(session, [d.id for _, d in rows])
    return CollectionDetail(
        **collection.model_dump(),
        document_ids=[d.id for _, d in rows],
        members=[
            CollectionMemberDetail(
                **CollectionMemberPublic.model_validate(m).model_dump(),
                document=DocumentSummary.build(d, stats[d.id]),
            )
            for m, d in rows
        ],
    )


@router.patch(
    "/{ref}",
    response_model=CollectionPublic,
    dependencies=WRITE,
    summary="Rename or describe a collection",
    description="Only the fields sent change. The slug stays, so links keep working.",
)
def update_collection(ref: str, body: CollectionUpdate, session: SessionDep) -> CollectionPublic:
    collection = collections.update_collection(session, ref, body.model_dump(exclude_unset=True))
    return _public(session, collection)


@router.delete(
    "/{ref}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=WRITE,
    summary="Delete a collection",
    description="Idempotent. The documents stay on the shelf.",
)
def delete_collection(ref: str, session: SessionDep) -> Response:
    collections.delete_collection(session, ref)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put(
    "/{ref}/members/{document_id}",
    response_model=CollectionMemberPublic,
    dependencies=WRITE,
    summary="Add a document, or change its note",
    description="A new member goes to the end of the reading order. For an existing "
    "member, `note` changes only when sent.",
)
def put_member(
    ref: str, document_id: uuid.UUID, session: SessionDep, body: MemberPut | None = None
) -> CollectionMemberPublic:
    body = body or MemberPut()
    member = collections.put_member(
        session, ref, document_id, note=body.note, set_note="note" in body.model_fields_set
    )
    return CollectionMemberPublic.model_validate(member)


@router.delete(
    "/{ref}/members/{document_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=WRITE,
    summary="Take a document out of a collection",
    description="Idempotent. The document stays on the shelf.",
)
def remove_member(ref: str, document_id: uuid.UUID, session: SessionDep) -> Response:
    collections.remove_member(session, ref, document_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put(
    "/{ref}/order",
    response_model=CollectionPublic,
    dependencies=WRITE,
    summary="Reorder the members",
    description="`document_ids` must name every current member exactly once, else `422`.",
)
def reorder(ref: str, body: CollectionOrder, session: SessionDep) -> CollectionPublic:
    return _public(session, collections.reorder(session, ref, body.document_ids))

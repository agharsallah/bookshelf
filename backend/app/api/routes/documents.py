"""Documents: ingest, browse, edit, and fix the outline (§13)."""

from collections.abc import Iterator
from typing import Annotated, Literal

import httpx
from fastapi import APIRouter, Depends, Query, Response, status
from fastapi import Path as PathParam
from fastapi.responses import FileResponse

from app.api.deps import LimitDep, OffsetDep, SessionDep, SettingsDep
from app.api.routes.media import MEDIA_HEADERS
from app.core.security import require_api_key
from app.models import Document
from app.models.enums import DocumentStatus, Genre
from app.schemas.common import Page
from app.schemas.document import (
    DocumentAccepted,
    DocumentCreate,
    DocumentDetail,
    DocumentPublic,
    DocumentRestored,
    DocumentResumed,
    DocumentSummary,
    DocumentUpdate,
    OutlineConfirmed,
    OutlineUpdate,
    ResumeRequest,
)
from app.schemas.job import JobPublic
from app.schemas.node import ANCHOR_PATTERN, DocumentTree, NodePublic, TreeNode
from app.services import archive, collections, covers, documents, fetch, ingest, tree
from app.services.media import IMAGE_TYPES

router = APIRouter(prefix="/documents", tags=["documents"])

DocumentRef = Annotated[
    str, PathParam(min_length=1, max_length=200, description="Document uuid or slug.")
]


def get_http_client() -> Iterator[httpx.Client]:
    """Outbound HTTP for URL ingest. Overridden in tests with an `httpx.MockTransport`."""
    with fetch.make_client() as client:
        yield client


HttpClientDep = Annotated[httpx.Client, Depends(get_http_client)]


@router.post(
    "",
    response_model=DocumentAccepted,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(require_api_key)],
    summary="Ingest a library file or a URL",
    description=(
        "`{path}` registers a file already inside `library/`; `{url}` fetches an HTML "
        "article (20 s, 20 MiB, 5 redirects) and keeps it under `library/articles/`. "
        "Duplicate content (same sha256) is `409` with the existing document in `details`. "
        "Returns `202` with the queued `parse` job."
    ),
)
def create_document(
    body: DocumentCreate, session: SessionDep, settings: SettingsDep, http: HttpClientDep
) -> DocumentAccepted:
    meta = ingest.IngestMetadata(
        title=body.title, authors=body.authors, year=body.year, tags=body.tags, genre=body.genre
    )
    if body.path is not None:
        document, job = ingest.ingest_path(session, settings.library_dir, body.path, meta)
    else:
        assert body.url is not None  # noqa: S101 - guaranteed by DocumentCreate
        document, job = ingest.ingest_url(session, settings.library_dir, http, body.url, meta)
    return DocumentAccepted(
        document=DocumentPublic.model_validate(document),
        job=JobPublic.model_validate(job),
        deduplicated=False,
    )


@router.get("", response_model=Page[DocumentSummary], summary="List documents")
def list_documents(
    session: SessionDep,
    limit: LimitDep = 50,
    offset: OffsetDep = 0,
    tag: Annotated[str | None, Query(max_length=64)] = None,
    status_: Annotated[DocumentStatus | None, Query(alias="status")] = None,
    author: Annotated[str | None, Query(max_length=200, description="Substring match.")] = None,
    q: Annotated[str | None, Query(max_length=200, description="Title substring.")] = None,
    genre: Annotated[Genre | None, Query(description="book | paper | article.")] = None,
    collection: Annotated[
        str | None, Query(max_length=200, description="A collection id or slug.")
    ] = None,
    archived: Annotated[
        bool, Query(description="`true` lists the archived documents instead of the shelf.")
    ] = False,
) -> Page[DocumentSummary]:
    filters = documents.DocumentFilters(
        tag=tag,
        status=status_,
        author=author,
        q=q,
        genre=genre,
        ids=collections.scope(session, collection),
        archived=archived,
    )
    rows, total = documents.list_documents(session, filters, limit=limit, offset=offset)
    stats = documents.document_stats(session, [d.id for d in rows])
    return Page(
        items=[DocumentSummary.build(d, stats[d.id]) for d in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


def _detail(session: SessionDep, document: Document) -> DocumentDetail:
    stats = documents.document_stats(session, [document.id])[document.id]
    return DocumentDetail.build(
        document,
        stats,
        outline_override=document.outline_override,
        meta=document.meta,
        jobs=documents.job_summary(session, document.id),
    )


@router.get("/{ref}", response_model=DocumentDetail, summary="Get a document and pipeline state")
def get_document(ref: DocumentRef, session: SessionDep) -> DocumentDetail:
    return _detail(session, documents.get_document(session, ref))


# A cover is remade when its book is re-parsed: revalidate daily (ETag), not yearly.
COVER_HEADERS = MEDIA_HEADERS | {"Cache-Control": "public, max-age=86400"}


@router.get(
    "/{ref}/cover",
    response_class=FileResponse,
    responses={
        200: {"content": {t: {} for t in sorted(set(IMAGE_TYPES.values()))}},
        404: {"description": "Not a book, or a book without a cover"},
    },
    summary="A book's cover image",
    description=(
        "The EPUB's cover image, or the PDF's first page rendered, made on first request and "
        "cached in the media folder. Papers and articles have none."
    ),
)
def get_cover(ref: DocumentRef, session: SessionDep, settings: SettingsDep) -> FileResponse:
    document = documents.get_document(session, ref)
    file, media_type = covers.cover_file(
        document, library_dir=settings.library_dir, media_dir=settings.media_dir
    )
    return FileResponse(file, media_type=media_type, headers=COVER_HEADERS)


@router.post(
    "/{ref}/resume",
    response_model=DocumentResumed,
    dependencies=[Depends(require_api_key)],
    summary="Resume a document the run ceiling paused",
    description=(
        "Clears `paused`, sets the document's own run ceiling (`max_runs`, default: another "
        "`max_runs_per_document` on top of the runs used so far) and requeues the jobs the "
        "ceiling failed. Safe on a document that is not paused."
    ),
)
def resume_document(
    ref: DocumentRef, session: SessionDep, settings: SettingsDep, body: ResumeRequest | None = None
) -> DocumentResumed:
    document = documents.get_document(session, ref)
    requeued = documents.resume(
        session,
        document,
        max_runs=body.max_runs if body is not None else None,
        default=settings.max_runs_per_document,
    )
    session.refresh(document)
    return DocumentResumed(
        document=_detail(session, document),
        requeued=[JobPublic.model_validate(j) for j in requeued],
    )


@router.patch(
    "/{ref}",
    response_model=DocumentPublic,
    dependencies=[Depends(require_api_key)],
    summary="Edit document metadata",
)
def update_document(ref: DocumentRef, body: DocumentUpdate, session: SessionDep) -> DocumentPublic:
    document = documents.get_document(session, ref)
    changes = body.model_dump(exclude_unset=True)
    return DocumentPublic.model_validate(documents.update_document(session, document, changes))


@router.delete(
    "/{ref}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_api_key)],
    summary="Delete a document for good",
    description=(
        "Removes the document and everything made from it: tree, notes, artifacts, jobs, "
        "reading and review history, its search points, graph slice, narrations and media. "
        "The original file in `library/` is kept (it can be added again) unless "
        "`file=true`. To put a document away and keep it all, archive it instead."
    ),
)
def delete_document(
    ref: DocumentRef,
    session: SessionDep,
    file: Annotated[bool, Query(description="Also delete the original from `library/`.")] = False,
) -> Response:
    document = documents.get_document(session, ref)
    documents.delete_document(session, document, remove_original=file)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{ref}/archive",
    response_model=DocumentPublic,
    dependencies=[Depends(require_api_key)],
    summary="Archive a document: off the shelf, nothing lost",
    description=(
        "Hides the document from the library, search and the review queue, drops it from "
        "the search index and holds its queued work. Everything it has (notes, artifacts, "
        "reading, recall) is kept, and `POST /documents/{ref}/restore` brings it back. "
        "Safe on an archived document."
    ),
)
def archive_document(ref: DocumentRef, session: SessionDep) -> DocumentPublic:
    document = archive.archive(session, documents.get_document(session, ref))
    return DocumentPublic.model_validate(document)


@router.post(
    "/{ref}/restore",
    response_model=DocumentRestored,
    dependencies=[Depends(require_api_key)],
    summary="Restore an archived document",
    description=(
        "Puts the document back on the shelf, requeues the work its archive held and, "
        "when it had been indexed, queues an `embed` so search finds it again. Safe on a "
        "document that is not archived."
    ),
)
def restore_document(ref: DocumentRef, session: SessionDep) -> DocumentRestored:
    document = documents.get_document(session, ref)
    requeued = archive.restore(session, document)
    session.refresh(document)
    return DocumentRestored(
        document=DocumentPublic.model_validate(document),
        requeued=[JobPublic.model_validate(j) for j in requeued],
    )


@router.get("/{ref}/tree", response_model=DocumentTree, summary="Get the document outline")
def get_tree(
    ref: DocumentRef,
    session: SessionDep,
    depth: Annotated[int, Query(ge=1, le=20, description="Levels from the top.")] = 2,
    include: Annotated[
        Literal["blocks"] | None, Query(description="`blocks` adds leaves to the tree.")
    ] = None,
) -> DocumentTree:
    document = documents.get_document(session, ref)
    include_blocks = include == "blocks"
    roots = tree.load_tree(session, document.id, depth=depth, include_blocks=include_blocks)
    return DocumentTree(
        document_id=document.id,
        slug=document.slug,
        depth=depth,
        include_blocks=include_blocks,
        nodes=[TreeNode.from_item(r) for r in roots],
    )


@router.patch(
    "/{ref}/outline",
    response_model=DocumentAccepted,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(require_api_key)],
    summary="Override the chapter/section outline and re-parse",
    description=(
        "Stores the override (it survives re-parsing) and queues a forced `parse` keyed by "
        "the override, so a parse already running cannot swallow it. Same shape and rules "
        "as the parser: pages 1-based and in order, `page_to` optional, `skip` marks a "
        "chapter that is not distilled, all within `page_count`. `{chapters: []}` removes "
        "the override."
    ),
)
def set_outline(ref: DocumentRef, body: OutlineUpdate, session: SessionDep) -> DocumentAccepted:
    document = documents.get_document(session, ref)
    chapters = [c.model_dump(exclude_none=True) for c in body.chapters]
    job, deduplicated = documents.set_outline(session, document, chapters)
    session.refresh(document)
    return DocumentAccepted(
        document=DocumentPublic.model_validate(document),
        job=JobPublic.model_validate(job),
        deduplicated=deduplicated,
    )


@router.post(
    "/{ref}/outline/confirm",
    response_model=OutlineConfirmed,
    dependencies=[Depends(require_api_key)],
    summary="Accept a guessed outline without editing it",
    description=(
        "`needs_review` → `parsed`, then the pipeline starts (element explanations, "
        "summaries, section notes). `409` unless the outline is waiting for review."
    ),
)
def confirm_outline(ref: DocumentRef, session: SessionDep) -> OutlineConfirmed:
    document = documents.get_document(session, ref)
    queued = documents.confirm_outline(session, document)
    session.refresh(document)
    return OutlineConfirmed(
        document=DocumentPublic.model_validate(document),
        jobs=[JobPublic.model_validate(j) for j in queued],
    )


@router.get(
    "/{ref}/blocks", response_model=Page[NodePublic], summary="List leaf blocks in reading order"
)
def list_blocks(
    ref: DocumentRef,
    session: SessionDep,
    limit: LimitDep = 50,
    offset: OffsetDep = 0,
    anchor_prefix: Annotated[
        str | None,
        Query(
            max_length=200,
            pattern=ANCHOR_PATTERN,
            description="`ch03` matches `ch03/...`, never `ch030`.",
        ),
    ] = None,
) -> Page[NodePublic]:
    document = documents.get_document(session, ref)
    rows, total = tree.list_blocks(
        session, document.id, anchor_prefix=anchor_prefix, limit=limit, offset=offset
    )
    return Page(
        items=[NodePublic.model_validate(n) for n in rows], total=total, limit=limit, offset=offset
    )

"""Documents: ingest, browse, edit, and fix the outline (§13)."""

from collections.abc import Iterator
from typing import Annotated, Literal

import httpx
from fastapi import APIRouter, Depends, Query, Response, status
from fastapi import Path as PathParam

from app.api.deps import LimitDep, OffsetDep, SessionDep, SettingsDep
from app.core.security import require_api_key
from app.models import Document
from app.models.enums import DocumentStatus
from app.schemas.common import Page
from app.schemas.document import (
    DocumentAccepted,
    DocumentCreate,
    DocumentDetail,
    DocumentPublic,
    DocumentResumed,
    DocumentSummary,
    DocumentUpdate,
    OutlineConfirmed,
    OutlineUpdate,
    ResumeRequest,
)
from app.schemas.job import JobPublic
from app.schemas.node import ANCHOR_PATTERN, DocumentTree, NodePublic, TreeNode
from app.services import documents, fetch, ingest, tree

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
        title=body.title, authors=body.authors, year=body.year, tags=body.tags
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
) -> Page[DocumentSummary]:
    filters = documents.DocumentFilters(tag=tag, status=status_, author=author, q=q)
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
    summary="Delete a document (the original file is kept)",
)
def delete_document(ref: DocumentRef, session: SessionDep) -> Response:
    documents.delete_document(session, documents.get_document(session, ref))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


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

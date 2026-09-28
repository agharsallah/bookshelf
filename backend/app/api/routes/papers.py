"""The paper shelf (docs/PAPERS.md §7): list and read papers, fix their metadata, rate
them, record reading passes, and browse the bibliography against the shelf.

`ref` is a document uuid or slug; a document that is not a paper is `404`. Included after
`paper_candidates` (and any other fixed `/papers/<word>` router), so those paths are not
read as a ref.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from fastapi import Path as PathParam

from app.api.deps import LimitDep, OffsetDep, SessionDep
from app.api.routes.documents import DocumentRef
from app.core.security import require_api_key
from app.models.enums import CitationIntent, DocumentStatus, PaperVerdict
from app.papers.enrich import queue_enrich
from app.schemas.job import JobPublic
from app.schemas.paper_shelf import (
    FacetCount,
    PaperDetail,
    PaperFacets,
    PaperPage,
    PaperReferenceRow,
    PaperSort,
    PaperSummary,
)
from app.schemas.papers import (
    PaperMetaPublic,
    PaperMetaUpdate,
    PaperPassPublic,
    PaperPassUpdate,
    PaperRatingCreate,
    PaperRatingPublic,
)
from app.services import paper_records, papers

router = APIRouter(prefix="/papers", tags=["papers"])

PassDep = Annotated[int, PathParam(alias="pass", ge=1, le=3, description="Reading pass, 1-3.")]


@router.get(
    "",
    response_model=PaperPage,
    summary="The paper shelf",
    description="Papers with their venue, your latest rating, highest pass, which paper "
    "artifacts exist, and counts. `facets` count venues and years over every paper.",
)
def list_papers(
    session: SessionDep,
    limit: LimitDep = 50,
    offset: OffsetDep = 0,
    q: Annotated[str | None, Query(max_length=200, description="Title or author.")] = None,
    venue: Annotated[str | None, Query(max_length=500, description="Exact, any case.")] = None,
    year: Annotated[int | None, Query(ge=-3000, le=3000)] = None,
    min_stars: Annotated[int | None, Query(ge=1, le=5, description="Latest rating.")] = None,
    pass_: Annotated[
        int | None, Query(alias="pass", ge=0, le=3, description="Highest pass; 0 = unread.")
    ] = None,
    verdict: Annotated[PaperVerdict | None, Query(description="Latest rating.")] = None,
    status_: Annotated[DocumentStatus | None, Query(alias="status")] = None,
    sort: PaperSort = PaperSort.RECENT,
) -> PaperPage:
    filters = papers.PaperFilters(
        q=q,
        venue=venue,
        year=year,
        min_stars=min_stars,
        pass_=pass_,
        verdict=verdict,
        status=status_,
        sort=sort.value,
    )
    rows, total = papers.list_papers(session, filters, limit=limit, offset=offset)
    counts = papers.facets(session)
    return PaperPage(
        items=[PaperSummary.build(f) for f in rows],
        total=total,
        limit=limit,
        offset=offset,
        facets=PaperFacets(
            venues=[FacetCount(value=v, count=n) for v, n in counts["venues"]],
            years=[FacetCount(value=y, count=n) for y, n in counts["years"]],
        ),
    )


@router.get("/{ref}", response_model=PaperDetail, summary="One paper, with meta and passes")
def get_paper(ref: DocumentRef, session: SessionDep) -> PaperDetail:
    return PaperDetail.build(papers.get_facts(session, ref))


@router.patch(
    "/{ref}/meta",
    response_model=PaperMetaPublic,
    dependencies=[Depends(require_api_key)],
    summary="Fix a paper's metadata",
    description="Only the fields sent change (`null` clears). The row becomes "
    "`source = human`: enrichment then only fills what you left blank. DOIs, arXiv and "
    "OpenAlex ids are normalized (`https://doi.org/10.1/X` → `10.1/x`).",
)
def update_meta(ref: DocumentRef, body: PaperMetaUpdate, session: SessionDep) -> PaperMetaPublic:
    document = papers.get_paper(session, ref)
    meta = paper_records.update_meta(session, document, body.model_dump(exclude_unset=True))
    return PaperMetaPublic.model_validate(meta)


@router.post(
    "/{ref}/enrich",
    response_model=JobPublic,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(require_api_key)],
    summary="Fetch the paper's metadata from OpenAlex",
    description="Queues `paper_enrich` (or returns the live one): venue, abstract, fields, "
    "counts, and reference ids matched to the shelf.",
)
def enrich_paper(ref: DocumentRef, session: SessionDep) -> JobPublic:
    job = queue_enrich(session, papers.get_paper(session, ref))
    assert job is not None  # noqa: S101 - get_paper guarantees a paper
    return JobPublic.model_validate(job)


@router.post(
    "/{ref}/ratings",
    response_model=PaperRatingPublic,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_api_key)],
    summary="Rate a paper",
    description="Append-only: a new rating supersedes the last one, which stays as history.",
)
def rate_paper(ref: DocumentRef, body: PaperRatingCreate, session: SessionDep) -> PaperRatingPublic:
    document = papers.get_paper(session, ref)
    rating = paper_records.add_rating(
        session, document, stars=body.stars, verdict=body.verdict, note=body.note
    )
    return PaperRatingPublic.model_validate(rating)


@router.get(
    "/{ref}/ratings",
    response_model=list[PaperRatingPublic],
    summary="Your rating history, newest (current) first",
)
def list_ratings(ref: DocumentRef, session: SessionDep) -> list[PaperRatingPublic]:
    document = papers.get_paper(session, ref)
    return [
        PaperRatingPublic.model_validate(r) for r in paper_records.rating_history(session, document)
    ]


@router.put(
    "/{ref}/passes/{pass}",
    response_model=PaperPassPublic,
    dependencies=[Depends(require_api_key)],
    summary="Mark a reading pass done",
    description="Idempotent: repeating it keeps the first `completed_at` and sets `note`.",
)
def complete_pass(
    ref: DocumentRef, pass_: PassDep, body: PaperPassUpdate, session: SessionDep
) -> PaperPassPublic:
    document = papers.get_paper(session, ref)
    done = paper_records.complete_pass(session, document, pass_, note=body.note)
    return PaperPassPublic.model_validate(done)


@router.delete(
    "/{ref}/passes/{pass}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_api_key)],
    summary="Undo a reading pass",
    description="Idempotent: `204` whether or not the pass was recorded.",
)
def undo_pass(ref: DocumentRef, pass_: PassDep, session: SessionDep) -> Response:
    paper_records.undo_pass(session, papers.get_paper(session, ref), pass_)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/{ref}/references",
    response_model=list[PaperReferenceRow],
    summary="The bibliography, matched to the shelf and the reading queue",
    description="In reference order. `target` is the shelf document an entry is; "
    "`candidate` the reading candidate with the same OpenAlex id, DOI or arXiv id.",
)
def list_references(
    ref: DocumentRef,
    session: SessionDep,
    intent: CitationIntent | None = None,
    on_shelf: Annotated[bool | None, Query(description="Only (un)matched entries.")] = None,
) -> list[PaperReferenceRow]:
    document = papers.get_paper(session, ref)
    rows = paper_records.list_references(session, document, intent=intent, on_shelf=on_shelf)
    return [PaperReferenceRow.build(r) for r in rows]

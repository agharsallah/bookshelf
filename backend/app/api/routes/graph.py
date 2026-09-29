"""The idea graph (§11, §13): one neighborhood at a time, and every edge's evidence.

`GET /graph/neighborhood` walks the graph from one focal node: depth ≤ 2, at most 150 nodes,
edges ranked by weight x evidence count. `GET /graph/atlas` is the one global view, and a
coarse one: books, chapters and concepts only, passages folded into their chapter.
Edges are proposed by skills and curated here: accept or reject a proposal, draw an edge
by hand (with evidence), or delete one.
"""

import uuid

from fastapi import APIRouter, Depends, Query, Response, status
from sqlmodel import select

from app.api.deps import SessionDep
from app.core.errors import NotFoundError
from app.core.security import require_api_key
from app.graph import atlas, curation, views
from app.graph.neighborhood import MAX_DEPTH, neighborhood
from app.graph.pipeline import bridge_spec
from app.graph.refs import RefError, resolve_ref
from app.jobs.queue import enqueue
from app.models import Document, Edge
from app.schemas.graph import (
    Atlas,
    BridgeQueued,
    BridgeRequest,
    EdgeCreate,
    EdgeDetail,
    EdgeUpdate,
    Neighborhood,
)
from app.services import collections

router = APIRouter(tags=["graph"])

COLLECTION = "A collection id or slug: keep only what belongs to its documents."


def _edge(session: SessionDep, edge_id: uuid.UUID) -> Edge:
    edge = session.get(Edge, edge_id)
    if edge is None:
        raise NotFoundError(f"Edge {edge_id} does not exist.")
    return edge


@router.get(
    "/graph/neighborhood", response_model=Neighborhood, summary="One focal node's neighborhood"
)
def get_neighborhood(
    session: SessionDep,
    node: str = Query(
        min_length=3,
        max_length=300,
        description="`concept:<id>`, `node:<document_id>#<anchor>`, `document:<id>`, "
        "`artifact:<id>`, or a bare id (concept, then document, then artifact).",
    ),
    depth: int = Query(default=1, ge=1, le=MAX_DEPTH),
    include_proposed: bool = Query(default=False, description="Also walk proposed edges."),
    collection: str | None = Query(default=None, max_length=200, description=COLLECTION),
) -> Neighborhood:
    try:
        focus = resolve_ref(session, node)
    except RefError as exc:
        raise NotFoundError(str(exc)) from exc
    hood = neighborhood(
        session,
        focus,
        depth=depth,
        include_proposed=include_proposed,
        document_ids=collections.scope(session, collection),
    )
    return views.neighborhood_out(hood)


@router.get("/graph/atlas", response_model=Atlas, summary="The whole shelf at chapter grain")
def get_atlas(
    session: SessionDep,
    include_proposed: bool = Query(default=False, description="Also fold proposed edges."),
    collection: str | None = Query(default=None, max_length=200, description=COLLECTION),
) -> Atlas:
    """Every book, every chapter taking part in the graph, and every live concept, with
    `contains` (book → chapter), the stored relations folded up to chapters, and derived
    `shares` lines between chapters that lean on the same concepts. With `collection`: only
    its documents, their chapters and the concepts those chapters touch."""
    scope = collections.scope(session, collection)
    return views.atlas_out(
        atlas.atlas(session, include_proposed=include_proposed, document_ids=scope)
    )


@router.post(
    "/graph/bridges",
    response_model=BridgeQueued,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(require_api_key)],
    summary="Ask how concepts relate across books (queues bridge jobs)",
)
def queue_bridges(body: BridgeRequest, session: SessionDep) -> BridgeQueued:
    """One `relate-concepts` bridge job per book (or the one named). Each sends at most
    `concept_bridge_max_pairs` cross-book pairs to the model; relations come back as
    proposed edges, to accept or reject on the map. Queued again while one waits: a no-op."""
    if body.document_id is not None and session.get(Document, body.document_id) is None:
        raise NotFoundError(f"Document {body.document_id} does not exist.")
    ids = [body.document_id] if body.document_id else list(session.exec(select(Document.id)).all())
    jobs = [job.id for doc in ids if (job := enqueue(session, bridge_spec(doc, ["manual"])))]
    return BridgeQueued(jobs=jobs)


@router.get("/edges/{edge_id}", response_model=EdgeDetail, summary="An edge and its evidence")
def get_edge(edge_id: uuid.UUID, session: SessionDep) -> EdgeDetail:
    return views.edge_detail(session, _edge(session, edge_id))


@router.post(
    "/edges",
    response_model=EdgeDetail,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_api_key)],
    summary="Draw an edge by hand (origin = human)",
)
def create_edge(body: EdgeCreate, session: SessionDep) -> EdgeDetail:
    edge = curation.create_edge(
        session,
        src=body.src,
        dst=body.dst,
        relation=body.relation,
        weight=body.weight,
        evidence=body.evidence,
    )
    return views.edge_detail(session, edge)


@router.patch(
    "/edges/{edge_id}",
    response_model=EdgeDetail,
    dependencies=[Depends(require_api_key)],
    summary="Accept or reject an edge",
)
def update_edge(edge_id: uuid.UUID, body: EdgeUpdate, session: SessionDep) -> EdgeDetail:
    """Accepting a `same_as` does not merge: merging is `POST /concepts/{id}/merge`."""
    edge = curation.set_edge_status(session, _edge(session, edge_id), body.status)
    return views.edge_detail(session, edge)


@router.delete(
    "/edges/{edge_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_api_key)],
    summary="Delete a hand-drawn edge, or reject a machine one",
)
def delete_edge(edge_id: uuid.UUID, session: SessionDep) -> Response:
    """Machine edges are rejected rather than deleted, so a re-run never brings them back."""
    curation.delete_edge(session, _edge(session, edge_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)

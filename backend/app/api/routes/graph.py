"""The idea graph (§11, §13): one neighborhood at a time, and every edge's evidence.

`GET /graph/neighborhood` walks the graph from one focal node: depth ≤ 2, at most 150 nodes,
edges ranked by weight x evidence count. `GET /graph/atlas` is the one global view, and a
coarse one: books, chapters and concepts only, passages folded into their chapter.
Edges are proposed by skills and curated here: accept or reject a proposal, draw an edge
by hand (with evidence), or delete one.
"""

import uuid

from fastapi import APIRouter, Depends, Query, Response, status

from app.api.deps import SessionDep
from app.core.errors import NotFoundError
from app.core.security import require_api_key
from app.graph import atlas, curation, views
from app.graph.neighborhood import MAX_DEPTH, neighborhood
from app.graph.refs import RefError, resolve_ref
from app.models import Edge
from app.schemas.graph import Atlas, EdgeCreate, EdgeDetail, EdgeUpdate, Neighborhood

router = APIRouter(tags=["graph"])


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
) -> Neighborhood:
    try:
        focus = resolve_ref(session, node)
    except RefError as exc:
        raise NotFoundError(str(exc)) from exc
    hood = neighborhood(session, focus, depth=depth, include_proposed=include_proposed)
    return views.neighborhood_out(hood)


@router.get("/graph/atlas", response_model=Atlas, summary="The whole shelf at chapter grain")
def get_atlas(
    session: SessionDep,
    include_proposed: bool = Query(default=False, description="Also fold proposed edges."),
) -> Atlas:
    """Every book, every chapter taking part in the graph, and every live concept, with
    `contains` (book → chapter), the stored relations folded up to chapters, and derived
    `shares` lines between chapters that lean on the same concepts."""
    return views.atlas_out(atlas.atlas(session, include_proposed=include_proposed))


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

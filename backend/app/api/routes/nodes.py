"""One node by its stable anchor (§13 `GET /nodes/{document}/{anchor}`)."""

from typing import Annotated

from fastapi import APIRouter
from fastapi import Path as PathParam

from app.api.deps import SessionDep
from app.api.routes.documents import DocumentRef
from app.schemas.node import ANCHOR_PATTERN, NodeSubtree, TreeNode
from app.services import documents, tree

router = APIRouter(prefix="/nodes", tags=["nodes"])


@router.get(
    "/{document_ref}/{anchor:path}",
    response_model=NodeSubtree,
    summary="Get one node, or a container with its subtree",
    description=f"Containers include every descendant, leaves too, up to {tree.SUBTREE_CAP}.",
)
def get_node(
    document_ref: DocumentRef,
    anchor: Annotated[str, PathParam(max_length=200, pattern=ANCHOR_PATTERN)],
    session: SessionDep,
) -> NodeSubtree:
    document = documents.get_document(session, document_ref)
    node = tree.get_node(session, document.id, anchor)
    subtree, truncated = tree.load_subtree(session, node)
    return NodeSubtree(
        document_id=document.id,
        slug=document.slug,
        node=TreeNode.from_item(subtree),
        truncated=truncated,
    )

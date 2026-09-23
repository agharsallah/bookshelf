"""Wire shapes for the document tree, blocks and single nodes (§13)."""

import uuid
from typing import Annotated, Any, Self

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import NodeKind
from app.services.tree import TreeItem

# Same grammar as the render contract's `anchor` ($defs/anchor).
ANCHOR_PATTERN = r"^[a-z]+[0-9]+(/[a-z]+[0-9]+)*$"
Anchor = Annotated[str, Field(min_length=1, max_length=200, pattern=ANCHOR_PATTERN)]


class NodePublic(BaseModel):
    """One node. Containers (part/chapter/section) carry `heading`; leaves carry `text`."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    anchor: Annotated[str, Field(examples=["ch03/s02/p014"])]
    kind: NodeKind
    ordinal: int
    depth: int
    heading: str | None
    text: str | None
    page_from: int | None
    page_to: int | None
    meta: Annotated[
        dict[str, Any],
        Field(description="Kind-specific data: `table`, `caption`, `image_path`, `language`."),
    ]


class TreeNode(NodePublic):
    children: list["TreeNode"] = []

    @classmethod
    def from_item(cls, item: TreeItem) -> Self:
        node = cls.model_validate(item.node)
        node.children = [cls.from_item(child) for child in item.children]
        return node


class DocumentTree(BaseModel):
    document_id: uuid.UUID
    slug: str
    depth: Annotated[int | None, Field(description="Levels returned; null = all.")]
    include_blocks: bool
    nodes: list[TreeNode]


class NodeSubtree(BaseModel):
    """One node; a container comes with its subtree, capped at `SUBTREE_CAP` nodes."""

    document_id: uuid.UUID
    slug: str
    node: TreeNode
    truncated: Annotated[bool, Field(description="True when the subtree hit the node cap.")]

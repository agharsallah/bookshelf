"""What a harvest reads: a document's preferred artifacts and the context around them.

Everything the pure harvesters need is loaded here, in a handful of queries:

* the **preferred** artifact per `(type, anchor, variant)` of every harvestable type: the
  latest approved version, else the latest non-rejected one (a draft: its pills say so);
* the units (`Tree.chapters()`: chapters, or a paper's top-level sections) with titles;
* figure crops (`meta.image_path`) by anchor, and the newest render of each voiced script;
* from the graph (`app.pills.graph_inputs`): claim support counts, the concept index and
  the cross-document connections.
"""

from collections.abc import Sequence
from dataclasses import dataclass, field

from sqlmodel import Session, col, select

from app.audio import store as audio_store
from app.core.config import get_settings
from app.models import Artifact, Document
from app.models.enums import ArtifactType, NodeKind, Review
from app.pills import graph_inputs
from app.pills.harvest import (
    HARVESTABLE_TYPES,
    ConnectionLink,
    HarvestContext,
    SourceArtifact,
    Unit,
)
from app.pipeline.artifacts import pick_preferred
from app.pipeline.tree import Tree


@dataclass(slots=True)
class HarvestInputs:
    context: HarvestContext
    artifacts: list[SourceArtifact]
    links: list[ConnectionLink] = field(default_factory=list)


def preferred_sources(session: Session, document_id: object) -> list[SourceArtifact]:
    """The preferred artifact per `(type, anchor, variant)` of every harvestable type."""
    rows = session.exec(
        select(Artifact)
        .where(
            Artifact.document_id == document_id,
            col(Artifact.type).in_(list(HARVESTABLE_TYPES)),
            Artifact.review != Review.REJECTED,
            col(Artifact.note_id).is_(None),
        )
        .order_by(col(Artifact.version))
    ).all()
    chosen = pick_preferred(rows, lambda row: (row.type, row.anchor, row.variant))
    return [SourceArtifact.of(row) for row in chosen.values()]


def units(tree: Tree) -> tuple[Unit, ...]:
    """The units pills belong to; front matter (title, copyright and cover pages, a book's
    `meta.front_matter` chapter) is none: what it says is no idea to learn."""
    return tuple(
        Unit(anchor=n.anchor, title=n.heading)
        for n in tree.chapters()
        if not n.meta.get("front_matter")
    )


def figures(tree: Tree) -> dict[str, str]:
    return {
        node.anchor: path
        for node in tree.walk()
        if node.kind is NodeKind.FIGURE and isinstance(path := node.meta.get("image_path"), str)
    }


def newest_renders(
    document: Document, artifacts: Sequence[SourceArtifact]
) -> dict[str, audio_store.Render]:
    """Artifact id → its newest complete render, for every voiced audio summary."""
    audio_dir = get_settings().audio_dir
    out: dict[str, audio_store.Render] = {}
    for artifact in artifacts:
        if artifact.type is not ArtifactType.AUDIO_SUMMARY or artifact.id is None:
            continue
        renders = audio_store.list_renders(audio_dir, document.id, str(artifact.id))
        if renders:
            out[str(artifact.id)] = renders[0]
    return out


def load(session: Session, document: Document) -> HarvestInputs:
    """Everything `harvest_document` reads for `document`."""
    artifacts = preferred_sources(session, document.id)
    tree = Tree.load(session, document)
    claim_sets = [a for a in artifacts if a.type is ArtifactType.CLAIM_SET]
    context = HarvestContext(
        document_id=document.id,
        slug=document.slug,
        genre=document.genre,
        units=units(tree),
        figures=figures(tree),
        claim_support=graph_inputs.claim_support(session, document.id, claim_sets),
        renders=newest_renders(document, artifacts),
        concept_index=graph_inputs.concept_index(session, document.id),
    )
    links = graph_inputs.connection_links(session, document)
    return HarvestInputs(context=context, artifacts=artifacts, links=links)

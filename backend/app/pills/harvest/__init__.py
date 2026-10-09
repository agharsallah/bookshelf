"""Harvesters (docs/PILLS.md §4): pills from what the pipeline already wrote, at zero tokens.

`HARVESTERS` maps each harvestable artifact type to its pure function; connection pills
come from the graph (`harvest_connections`), not from an artifact. `harvest_document` runs
them all over a document's preferred artifacts and returns the pills it should have:

* one idea per pill; the same idea from two sources (a glossary term the distillation also
  defines) is kept once, the first source in `HARVESTERS` order winning;
* concepts: each pill names the concepts whose accepted edges rest on the passages it cites.
"""

from collections.abc import Iterable, Mapping, Sequence

from app.models.enums import ArtifactType
from app.pills.harvest.audio import harvest_audio
from app.pills.harvest.base import (
    HarvestContext,
    Harvester,
    HarvestInput,
    PillDraft,
    SourceArtifact,
    Unit,
)
from app.pills.harvest.distillations import harvest_distillation, harvest_salience
from app.pills.harvest.figures import harvest_figure
from app.pills.harvest.graph import ConnectionLink, LinkSide, harvest_connections
from app.pills.harvest.guide import harvest_guide, harvest_paper_card
from app.pills.harvest.papers import harvest_claims, harvest_math
from app.pills.harvest.pill_set import harvest_pill_set
from app.pills.harvest.study import (
    harvest_flashcards,
    harvest_glossary,
    harvest_quiz,
    harvest_quotes,
)

__all__ = [
    "HARVESTABLE_TYPES",
    "HARVESTERS",
    "ConnectionLink",
    "HarvestContext",
    "HarvestInput",
    "Harvester",
    "LinkSide",
    "PillDraft",
    "SourceArtifact",
    "Unit",
    "harvest_document",
]

MAX_CONCEPTS = 6

# Order matters only for duplicates: the earlier source keeps the idea.
HARVESTERS: dict[ArtifactType, Harvester] = {
    ArtifactType.PILL_SET: harvest_pill_set,
    ArtifactType.CHAPTER_DISTILLATION: harvest_distillation,
    ArtifactType.SALIENCE_MARKS: harvest_salience,
    ArtifactType.GLOSSARY: harvest_glossary,
    ArtifactType.QUOTE_SET: harvest_quotes,
    ArtifactType.QUIZ: harvest_quiz,
    ArtifactType.FLASHCARDS: harvest_flashcards,
    ArtifactType.FIGURE_DESCRIPTION: harvest_figure,
    ArtifactType.BOOK_GUIDE: harvest_guide,
    ArtifactType.PAPER_CARD: harvest_paper_card,
    ArtifactType.CLAIM_SET: harvest_claims,
    ArtifactType.MATH_EXPLAINER: harvest_math,
    ArtifactType.AUDIO_SUMMARY: harvest_audio,
}
HARVESTABLE_TYPES = frozenset(HARVESTERS)
_ORDER = {kind: i for i, kind in enumerate(HARVESTERS)}


def concepts_for(cites: Iterable[str], index: Mapping[str, Sequence[str]]) -> list[str]:
    """Concepts resting on a cited passage or anywhere under a cited container."""
    found: dict[str, None] = {}
    for cite in cites:
        for anchor, names in index.items():
            if anchor == cite or anchor.startswith(f"{cite}/"):
                found.update(dict.fromkeys(names))
    return list(found)


def harvest_document(
    context: HarvestContext,
    artifacts: Iterable[SourceArtifact],
    links: Sequence[ConnectionLink] = (),
) -> list[PillDraft]:
    """Every pill the document should have, each `source_key` and idea once."""
    ordered = sorted(
        (a for a in artifacts if a.type in HARVESTERS),
        key=lambda a: (_ORDER[a.type], a.anchor or "", a.variant or ""),
    )
    drafts: list[PillDraft] = []
    for artifact in ordered:
        drafts.extend(HARVESTERS[artifact.type](HarvestInput(context, artifact)))
    drafts.extend(harvest_connections(context, list(links)))
    keys: set[str] = set()
    ideas: set[str] = set()
    out: list[PillDraft] = []
    for pill in drafts:
        if pill.source_key in keys or pill.fingerprint in ideas:
            continue
        keys.add(pill.source_key)
        ideas.add(pill.fingerprint)
        named = dict.fromkeys([*pill.concepts, *concepts_for(pill.cites, context.concept_index)])
        pill.concepts = list(named)[:MAX_CONCEPTS]
        out.append(pill)
    return out

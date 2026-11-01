"""A document's generated knowledge as one reading, in two editions.

**Assembled** — every approved note a person would sit down with, in a fixed order:
the brief or paper card and the guide, then each chapter's summary, distillation and
notes (headed by the guide's takeaway for that chapter), then the glossary, quotes and
the rest. Quizzes, audio scripts, pills and the catalogue stay out: they are drills and
shelf metadata, not a reading.

**Composed** — the same notes woven around a `reading_edition` artifact
(compose-reading): its preface and through-line open the reading, each chapter opens
with the edition's bridge (what the chapter adds, and which parts it leans on) before
its notes, the connections close the argument, and the brief, guide, glossary and the
rest follow as reference. Both render through `app.reading.pdf`.
"""

from dataclasses import dataclass, replace
from typing import TYPE_CHECKING, Any

from app.models import Artifact, Document
from app.models.enums import ArtifactType, Genre, NodeKind
from app.reading.model import (
    CONNECTIONS,
    THROUGH_LINE,
    Block,
    Piece,
    Reading,
    html_id,
    knowledge_blocks,
    plain,
)
from app.services.tree import walk

if TYPE_CHECKING:  # exports imports this module to write the PDF
    from app.services.exports import ExportBundle

# Document-scope pieces, in the order a reader meets them: (type, kicker, title).
_FRONT: tuple[tuple[ArtifactType, str, str], ...] = (
    (ArtifactType.BOOK_BRIEF, "Brief", "The brief"),
    (ArtifactType.BOOK_GUIDE, "Guide", "The guide"),
    (ArtifactType.BOOK_SUMMARY, "Summary", "The book in short"),
    (ArtifactType.PAPER_CARD, "Paper", "The paper"),
    (ArtifactType.PAPER_EXPLAINER, "Explainer", "Explained"),
    (ArtifactType.PAPER_ASSESSMENT, "Assessment", "Assessment"),
    (ArtifactType.PAPER_REVIEW, "Review", "Peer review"),
    (ArtifactType.JOURNAL_CLUB, "Journal club", "Journal club"),
)
_TAIL: tuple[tuple[ArtifactType, str, str], ...] = (
    (ArtifactType.GLOSSARY, "Glossary", "Glossary"),
    (ArtifactType.QUOTE_SET, "Quotes", "Quotes"),
    (ArtifactType.FAQ, "Questions", "Questions"),
    (ArtifactType.CLAIM_SET, "Claims", "Claims"),
    (ArtifactType.RESULTS_TABLE, "Results", "Results"),
    (ArtifactType.NOTATION_TABLE, "Notation", "Notation"),
    (ArtifactType.MATH_EXPLAINER, "Maths", "The maths"),
)
# Inside a chapter, in reading order. Several of one type (section notes, figures) each
# get their own heading.
_IN_CHAPTER: dict[ArtifactType, str] = {
    ArtifactType.CHAPTER_SUMMARY: "Summary",
    ArtifactType.CHAPTER_DISTILLATION: "Distillation",
    ArtifactType.SECTION_NOTE: "Notes",
    ArtifactType.FIGURE_DESCRIPTION: "Figure",
    ArtifactType.TABLE_EXPLANATION: "Table",
    ArtifactType.CODE_EXPLANATION: "Code",
    ArtifactType.MATH_DESCRIPTION: "Formula",
    ArtifactType.STRUCTURED_NOTE: "Your note",
    ArtifactType.GLOSSARY: "Glossary",
    ArtifactType.QUOTE_SET: "Quotes",
    ArtifactType.FAQ: "Questions",
}
_CHAPTER_ORDER = {kind: index for index, kind in enumerate(_IN_CHAPTER)}
_LABELS = {kind: (kicker, title) for kind, kicker, title in (*_FRONT, *_TAIL)}
_FRONT_TYPES = {kind for kind, _, _ in _FRONT}
_TAIL_TYPES = {kind for kind, _, _ in _TAIL}
_READING_TYPES = _FRONT_TYPES | _TAIL_TYPES | set(_IN_CHAPTER)
# write-guide's journey roles (skills/write-guide), as a chapter kicker suffix.
_ROLES = {
    "setup": "Setup",
    "concept": "Concept",
    "method": "Method",
    "evidence": "Evidence",
    "application": "Application",
    "synthesis": "Synthesis",
}


@dataclass(frozen=True, slots=True)
class _Chapter:
    anchor: str
    heading: str
    kicker: str  # "Chapter 3", or "Section 3" for a paper
    role: str  # the guide's journey role label, or ""
    takeaway: str  # the guide's journey takeaway, or ""
    blocks: list[Block]  # the approved notes, each under its own heading


@dataclass(frozen=True, slots=True)
class _Shelf:
    """The approved notes, sorted into the places a reader meets them."""

    front: list[Piece]
    chapters: list[_Chapter]
    orphans: list[Piece]
    tail: list[Piece]


def assemble(bundle: "ExportBundle") -> Reading:
    """The approved notes, in reading order. An empty shelf is still a cover."""
    shelf = _shelf(bundle)
    chapters = [
        Piece(
            html_id(ch.anchor),
            "Chapters",
            " · ".join(filter(None, (ch.kicker, ch.role))),
            ch.heading,
            ch.blocks,
            deck=ch.takeaway,
        )
        for ch in shelf.chapters
        if ch.blocks
    ]
    return Reading(
        title=bundle.document.title,
        byline=_byline(bundle.document),
        edition="Reading companion",
        deck="The approved distillations, summaries and notes, in reading order.",
        pieces=[*_grouped(shelf.front, "Overview"), *chapters, *shelf.orphans, *shelf.tail],
        chapters=_anchor_ids(shelf, chapters),
    )


def composed_artifact(bundle: "ExportBundle") -> Artifact | None:
    """The approved document-scope edition, preferring one without a variant."""
    editions = [
        a for a in bundle.artifacts if a.type is ArtifactType.READING_EDITION and a.anchor is None
    ]
    return next((a for a in editions if not a.variant), editions[0] if editions else None)


def compose(bundle: "ExportBundle", artifact: Artifact) -> Reading:
    """The edition's argument, with each chapter's approved notes inside its part."""
    body = artifact.body
    shelf = _shelf(bundle)
    parts = {str(p.get("id")): p for p in body.get("parts") or [] if isinstance(p, dict)}
    titles = {pid: str(part.get("title") or pid) for pid, part in parts.items()}

    def see(part: dict[str, Any], own: str) -> tuple[tuple[str, str], ...]:
        targets = [t for t in part.get("see") or [] if t in titles and t != own]
        return tuple((html_id(t), titles[t]) for t in targets)

    def blocks_of(value: Any) -> list[Block]:
        return [b for b in value or [] if isinstance(b, dict)]

    edition_title = str(body.get("title") or "One linked edition")
    opening: list[Piece] = []
    if preface := blocks_of(body.get("preface")):
        opening.append(
            Piece("preface", "Introduction", "How to read this", "This edition", preface)
        )
    if line := parts.get(THROUGH_LINE):
        opening.append(
            Piece(
                THROUGH_LINE,
                "Introduction",
                "The through-line",
                titles[THROUGH_LINE],
                blocks_of(line.get("blocks")),
                see=see(line, THROUGH_LINE),
            )
        )
    chapters: list[Piece] = []
    for ch in shelf.chapters:
        part = parts.get(ch.anchor)
        if part is None and not ch.blocks:
            continue
        chapters.append(
            Piece(
                html_id(ch.anchor),
                "Chapters",
                f"{ch.kicker} · {ch.heading}" if part else ch.kicker,
                titles[ch.anchor] if part else ch.heading,
                ch.blocks,
                deck="" if part else ch.takeaway,
                lead=blocks_of(part.get("blocks")) if part else [],
                see=see(part, ch.anchor) if part else (),
            )
        )
    closing: list[Piece] = []
    if ending := parts.get(CONNECTIONS):
        closing.append(
            Piece(
                CONNECTIONS,
                "Connections",
                "Where the ideas return",
                titles[CONNECTIONS],
                blocks_of(ending.get("blocks")),
                see=see(ending, CONNECTIONS),
            )
        )
    reference = _grouped([*shelf.front, *shelf.tail], "Reference")
    return Reading(
        title=bundle.document.title,
        byline=_byline(bundle.document),
        edition="Composed edition",
        deck=edition_title,
        pieces=[*opening, *chapters, *closing, *shelf.orphans, *reference],
        chapters=_anchor_ids(shelf, chapters),
    )


# --- Sorting the shelf -----------------------------------------------------------------


def _shelf(bundle: "ExportBundle") -> _Shelf:
    headings = {
        item.node.anchor: item.node.heading or item.node.anchor for item in walk(bundle.roots)
    }
    anchors = [
        item.node.anchor for item in walk(bundle.roots) if item.node.kind is NodeKind.CHAPTER
    ]
    grouped: dict[str, list[Artifact]] = {anchor: [] for anchor in anchors}
    front: list[Artifact] = []
    tail: list[Artifact] = []
    orphans: list[Artifact] = []
    guide: Artifact | None = None
    for artifact in bundle.artifacts:
        if artifact.type is ArtifactType.BOOK_GUIDE and artifact.anchor is None and guide is None:
            guide = artifact
        if artifact.type not in _READING_TYPES:
            continue
        if artifact.anchor is None:
            if artifact.type in _FRONT_TYPES:
                front.append(artifact)
            elif artifact.type in _TAIL_TYPES:
                tail.append(artifact)
        elif artifact.type in _IN_CHAPTER:
            chapter = _chapter_of(artifact.anchor, anchors)
            (grouped[chapter] if chapter else orphans).append(artifact)
    journey = _journey(guide)
    unit = "Section" if bundle.document.genre is Genre.PAPER else "Chapter"
    chapters = [
        _Chapter(
            anchor=anchor,
            heading=headings.get(anchor, anchor),
            kicker=f"{unit} {number}",
            role=journey.get(anchor, ("", ""))[0],
            takeaway=journey.get(anchor, ("", ""))[1],
            blocks=_chapter_blocks(anchor, grouped[anchor], headings),
        )
        for number, anchor in enumerate(anchors, start=1)
    ]
    return _Shelf(
        front=_pieces(front),
        chapters=chapters,
        orphans=[p for a in orphans if (p := _orphan_piece(a, headings))],
        tail=_pieces(tail),
    )


def _journey(guide: Artifact | None) -> dict[str, tuple[str, str]]:
    """write-guide's journey: per chapter anchor, (role label, takeaway text)."""
    if guide is None:
        return {}
    out: dict[str, tuple[str, str]] = {}
    for step in guide.body.get("journey") or []:
        if isinstance(step, dict) and step.get("anchor"):
            role = _ROLES.get(str(step.get("role") or ""), "")
            out[str(step["anchor"])] = (role, plain(step.get("takeaway")))
    return out


def _chapter_of(anchor: str, chapters: list[str]) -> str | None:
    match = [ch for ch in chapters if anchor == ch or anchor.startswith(ch + "/")]
    return max(match, key=len) if match else None


def _chapter_blocks(
    anchor: str, artifacts: list[Artifact], headings: dict[str, str]
) -> list[Block]:
    ordered = sorted(artifacts, key=lambda a: (_CHAPTER_ORDER.get(a.type, 99), a.anchor or ""))
    blocks: list[Block] = []
    for artifact in ordered:
        if found := knowledge_blocks(artifact.body):
            label = _subsection(artifact, anchor, headings)
            blocks.extend([{"type": "heading", "level": 2, "text": label}, *found])
    return blocks


def _subsection(artifact: Artifact, chapter: str, headings: dict[str, str]) -> str:
    label = _IN_CHAPTER[artifact.type]
    if artifact.anchor in (None, chapter):
        return label
    heading = headings.get(artifact.anchor or "", "")
    if artifact.type is ArtifactType.SECTION_NOTE and heading:
        return heading
    return f"{label} · {heading or artifact.anchor}"


def _pieces(artifacts: list[Artifact]) -> list[Piece]:
    pieces = []
    for artifact in artifacts:
        if blocks := knowledge_blocks(artifact.body):
            kicker, title = _LABELS[artifact.type]
            if artifact.variant:
                title = f"{title} · {artifact.variant}"
            pid = artifact.type.value.replace("_", "-")
            pid = f"{pid}-{artifact.variant}" if artifact.variant else pid
            pieces.append(Piece(html_id(pid), "Reference", kicker, title, blocks))
    return pieces


def _orphan_piece(artifact: Artifact, headings: dict[str, str]) -> Piece | None:
    """A note anchored outside every chapter (front matter, a paper's abstract)."""
    found = knowledge_blocks(artifact.body)
    if not found:
        return None
    anchor = artifact.anchor or artifact.type.value
    label = _IN_CHAPTER.get(artifact.type, artifact.type.value)
    blocks: list[Block] = [{"type": "heading", "level": 2, "text": label}, *found]
    return Piece(html_id(anchor), "Notes", label, headings.get(anchor, label), blocks)


def _grouped(pieces: list[Piece], group: str) -> list[Piece]:
    return [replace(piece, group=group) for piece in pieces]


def _anchor_ids(shelf: _Shelf, pieces: list[Piece]) -> dict[str, str]:
    """Chapter anchor → piece id, for the chapters that made it into the reading."""
    printed = {p.id for p in pieces}
    return {ch.anchor: html_id(ch.anchor) for ch in shelf.chapters if html_id(ch.anchor) in printed}


def _byline(document: Document) -> str:
    authors = ", ".join(document.authors)
    if authors and document.year:
        return f"{authors} · {document.year}"
    return authors or (str(document.year) if document.year else "")

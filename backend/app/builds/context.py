"""The paper's ideas for a build (docs/BUILDS.md B8, B12): `docs/PAPER.md` and the planner's
input.

    paper_brief(session, document)      the data: `selectors.sets._paper` (card, claims,
                                        results) + the preferred explainer + paper_meta links
    paper_sections(brief)               pure: the nine sections (`SECTIONS`), each with its
                                        Markdown and word count ("" when the shelf lacks it)
    render_paper_md(brief, link_paper,  pure: the header and the kept, non-empty sections,
                    sections)           every cite, anchor and `[n]` marker stripped
    missing_context(brief)              what the shelf does not know yet (preflight warnings)

The repo carries the paper's ideas, not its apparatus: no citations, no anchors.
"""

from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any

from sqlmodel import Session, col, select

from app.builds import context_sections as render
from app.builds.context_sections import clean_text, strip_apparatus
from app.models import Artifact, Document, PaperMeta
from app.models.enums import ArtifactType, ExplainerLevel, Review
from app.papers.selectors.sets import _paper
from app.pipeline import artifacts

__all__ = [
    "SECTIONS", "PaperBrief", "Section", "clean_text", "missing_context", "paper_brief",
    "paper_sections", "render_header", "render_paper_md", "strip_apparatus",
]  # fmt: skip

# The sections of docs/PAPER.md, in order: (key, title). `options.context.sections` keeps a
# subset by key (docs/BUILDS.md §7, `ContextSectionKey`).
SECTIONS: tuple[tuple[str, str], ...] = (
    ("tldr", "TL;DR"),
    ("question", "The question"),
    ("core_ideas", "Core ideas"),
    ("how_it_works", "How it works"),
    ("equations", "Key equations"),
    ("setup", "Setup"),
    ("results", "Key numbers and results"),
    ("claims", "Claims"),
    ("limitations", "Limitations and open questions"),
)
PREFERRED_LEVEL = ExplainerLevel.PRACTITIONER.value


@dataclass(frozen=True, slots=True)
class PaperBrief:
    """Everything the shelf knows about a paper that a build can use (cites still in)."""

    slug: str
    title: str
    authors: tuple[str, ...] = ()
    year: int | None = None
    venue: str | None = None
    abstract: str | None = None
    links: tuple[tuple[str, str], ...] = ()  # (label, url)
    card: dict[str, Any] | None = None
    card_review: Review | None = None
    claims: list[dict[str, Any]] = field(default_factory=list)
    results: list[dict[str, Any]] = field(default_factory=list)
    explainer: dict[str, Any] | None = None
    explainer_level: str | None = None

    @property
    def card_approved(self) -> bool:
        return self.card is not None and self.card_review is Review.APPROVED


# --- gathering ----------------------------------------------------------------------------


def _links(meta: PaperMeta | None) -> tuple[tuple[str, str], ...]:
    if meta is None:
        return ()
    out = []
    if meta.arxiv_id:
        out.append(("arXiv", f"https://arxiv.org/abs/{meta.arxiv_id}"))
    if meta.doi:
        out.append(("DOI", f"https://doi.org/{meta.doi}"))
    return tuple(out)


def preferred_explainer(session: Session, document_id: object) -> Artifact | None:
    """Per level the latest approved explainer, else the latest one; the practitioner level
    first, else an approved one, else the newest."""
    rows = session.exec(
        select(Artifact)
        .where(
            Artifact.document_id == document_id,
            Artifact.type == ArtifactType.PAPER_EXPLAINER,
            col(Artifact.anchor).is_(None),
            Artifact.review != Review.REJECTED,
        )
        .order_by(col(Artifact.version))
    ).all()
    by_level = artifacts.pick_preferred(rows, lambda a: a.variant)
    if not by_level:
        return None
    if PREFERRED_LEVEL in by_level:
        return by_level[PREFERRED_LEVEL]
    return max(by_level.values(), key=lambda a: (a.review is Review.APPROVED, a.created_at))


def paper_brief(session: Session, document: Document) -> PaperBrief:
    paper, _ = _paper(session, document)
    card_row = artifacts.preferred(session, document.id, [ArtifactType.PAPER_CARD]).get(
        (ArtifactType.PAPER_CARD, None)
    )
    explainer = preferred_explainer(session, document.id)
    return PaperBrief(
        slug=document.slug,
        title=document.title,
        authors=tuple(paper["authors"]),
        year=paper["year"],
        venue=paper["venue"],
        abstract=paper["abstract"],
        links=_links(session.get(PaperMeta, document.id)),
        card=paper["card"],
        card_review=card_row.review if card_row else None,
        claims=paper["claims"],
        results=paper["results"],
        explainer=explainer.body if explainer else None,
        explainer_level=explainer.variant if explainer else None,
    )


def missing_context(brief: PaperBrief) -> list[str]:
    """What is absent, as preflight check keys: `paper_card` (no approved card: none, or a
    draft only), `claims`, `results`, `explainer`."""
    missing = [] if brief.card_approved else ["paper_card"]
    missing += [] if brief.claims else ["claims"]
    missing += [] if any(r.get("is_proposed") for r in brief.results) else ["results"]
    missing += [] if brief.explainer else ["explainer"]
    return missing


# --- rendering ----------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Section:
    key: str
    title: str
    markdown: str  # the body, without its `## title`
    words: int


def word_count(text: str) -> int:
    return len(text.split())


def paper_sections(brief: PaperBrief) -> list[Section]:
    """All nine sections in `SECTIONS` order, empty ones included (`markdown == ""`)."""
    card, explainer = brief.card or {}, brief.explainer or {}
    bodies = {
        "tldr": render.spans(card.get("tldr")) or clean_text(brief.abstract or ""),
        "question": render.spans(card.get("question")),
        "core_ideas": render.core_ideas(card),
        "how_it_works": render.how_it_works(card, explainer),
        "equations": render.equations(explainer),
        "setup": render.setup(card),
        "results": render.results(card, brief.results),
        "claims": render.claims(brief.claims),
        "limitations": render.limitations(card),
    }
    return [Section(key, title, bodies[key], word_count(bodies[key])) for key, title in SECTIONS]


def render_header(brief: PaperBrief, *, link_paper: bool) -> str:
    """The title line: the paper named and linked, or a neutral one without `link_paper`."""
    if not link_paper:
        return "# The paper's core ideas"
    byline = ", ".join(brief.authors)
    when = " · ".join(str(x) for x in (brief.venue, brief.year) if x)
    lines = [f"# {brief.title}", "", " · ".join(x for x in (byline, when) if x)]
    if brief.links:
        lines += ["", " · ".join(f"[{label}]({url})" for label, url in brief.links)]
    return "\n".join(lines).rstrip()


def render_paper_md(
    brief: PaperBrief, *, link_paper: bool, sections: Iterable[str] | None = None
) -> str:
    """`docs/PAPER.md`: the paper's core ideas, no citations. `sections` keeps those keys
    (None: all); a section without data is left out either way. `link_paper` names and
    links the paper in the title."""
    keep = None if sections is None else set(sections)
    body = [
        f"## {s.title}\n\n{s.markdown}"
        for s in paper_sections(brief)
        if s.markdown and (keep is None or s.key in keep)
    ]
    return "\n\n".join([render_header(brief, link_paper=link_paper), *body]) + "\n"

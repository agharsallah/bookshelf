"""PAPER.md: the paper's ideas from the shelf, with every citation, anchor and marker gone."""

import re

from sqlmodel import Session

from app.builds.context import (
    SECTIONS,
    PaperBrief,
    clean_text,
    missing_context,
    paper_brief,
    paper_sections,
    render_header,
    render_paper_md,
)
from app.models.enums import Review
from app.schemas.build_options import SECTION_KEYS
from tests.builds.factories import known_paper

ANCHOR = re.compile(r"\b[a-z]{1,3}\d+(/[a-z]{1,3}\d+)+\b")


def test_the_brief_gathers_card_claims_results_explainer_and_links(session: Session):
    paper = known_paper(session, meta={"arxiv_id": "2101.00001", "doi": "10.1/x"})

    brief = paper_brief(session, paper)

    assert brief.card_approved and brief.card is not None
    assert {c["key"] for c in brief.claims} == {"C1", "C2", "C3"}
    assert brief.results[0]["is_proposed"] is True
    assert brief.explainer_level == "practitioner"
    assert dict(brief.links) == {
        "arXiv": "https://arxiv.org/abs/2101.00001",
        "DOI": "https://doi.org/10.1/x",
    }
    assert missing_context(brief) == []


def test_the_practitioner_explainer_is_preferred_else_the_approved_one(session: Session):
    both = paper_brief(session, known_paper(session, explainer_levels=("newcomer", "practitioner")))
    other = paper_brief(session, known_paper(session, explainer_levels=("expert",)))

    assert both.explainer_level == "practitioner"
    assert other.explainer_level == "expert"


def test_paper_md_has_every_section_and_no_apparatus(session: Session):
    text = render_paper_md(paper_brief(session, known_paper(session)), link_paper=True)

    for heading in ("TL;DR", "The question", "Core ideas", "How it works", "Key equations",
                    "Setup", "Key numbers and results", "Claims",
                    "Limitations and open questions"):  # fmt: skip
        assert f"## {heading}\n" in text
    assert "# Gated Readers" in text and "https://arxiv.org/abs/2101.00001" in text
    assert "A gate scores each passage before the reader sees it." in text
    assert "<sup>" not in text and "#ch" not in text
    assert not ANCHOR.search(text), "no anchors survive"
    assert "[3]" not in text and "[7]" not in text
    assert "| GRA | NQ | EM | 50.3 |" in text
    assert "The practitioner analogy." in text and "g_i = \\sigma(w^T x)" in text


def test_claims_are_grouped_by_kind_with_measured_first(session: Session):
    text = render_paper_md(paper_brief(session, known_paper(session)), link_paper=True)
    claims = text.split("## Claims")[1].split("## Limitations")[0]

    assert claims.index("### Method") < claims.index("### Result")
    result = claims.split("### Result")[1]
    assert result.index("Claim C2 holds. *(measured)*") < result.index("Claim C1 holds. *(argued)*")


def test_without_link_paper_the_paper_is_not_named(session: Session):
    text = render_paper_md(paper_brief(session, known_paper(session)), link_paper=False)

    assert text.startswith("# The paper's core ideas")
    assert "Gated Readers" not in text and "arxiv.org" not in text


def test_empty_sections_are_left_out():
    text = render_paper_md(PaperBrief(slug="p", title="P", abstract="Only an abstract [2]."),
                           link_paper=True)  # fmt: skip

    assert "## TL;DR\n\nOnly an abstract." in text
    assert "## Claims" not in text and "## How it works" not in text


def test_missing_context_names_what_the_shelf_lacks(session: Session):
    bare = known_paper(session, card=Review.DRAFT, explainer_levels=(), claims=False,
                       results=False)  # fmt: skip

    assert missing_context(paper_brief(session, bare)) == [
        "paper_card", "claims", "results", "explainer",
    ]  # fmt: skip


def test_clean_text_strips_markers_and_anchors_but_keeps_links():
    assert clean_text("Gains [3, 7] hold (ch04/s02/p001) and [12\u201314].") == "Gains hold and."
    assert clean_text("See [the docs](https://x.y) [2]") == "See [the docs](https://x.y)"


def test_the_nine_sections_match_the_wire_keys_and_count_their_words(session: Session):
    sections = paper_sections(paper_brief(session, known_paper(session)))

    assert [s.key for s in sections] == list(SECTION_KEYS) == [k for k, _ in SECTIONS]
    tldr = sections[0]
    assert tldr.title == "TL;DR" and tldr.markdown.startswith("A gate scores each passage")
    assert tldr.words == len(tldr.markdown.split()) > 0
    assert all(s.markdown and s.words for s in sections)


def test_all_sections_kept_is_the_same_document_as_none(session: Session):
    brief = paper_brief(session, known_paper(session))

    every = render_paper_md(brief, link_paper=True, sections=list(SECTION_KEYS))

    assert every == render_paper_md(brief, link_paper=True)
    assert every.startswith(render_header(brief, link_paper=True) + "\n\n## TL;DR")


def test_a_switched_off_section_is_left_out(session: Session):
    brief = paper_brief(session, known_paper(session))

    text = render_paper_md(brief, link_paper=True, sections=["tldr", "how_it_works"])

    assert "## TL;DR" in text and "## How it works" in text
    for gone in ("## Claims", "## Key equations", "## Setup", "## Limitations"):
        assert gone not in text
    assert render_paper_md(brief, link_paper=False, sections=[]) == "# The paper's core ideas\n"


def test_empty_sections_are_listed_with_no_words():
    sections = paper_sections(PaperBrief(slug="p", title="P", abstract="Only this."))

    assert [s.key for s in sections if s.words] == ["tldr"]
    assert next(s for s in sections if s.key == "claims").markdown == ""

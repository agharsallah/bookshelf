"""The study and critique bodies flatten into render blocks (app/papers/render_study.py)
for exports, search indexing and hits."""

import pytest

from app.models.enums import ArtifactType
from app.pipeline.bodies import leaf_spans
from app.retrieval.points import INDEXED_TYPES, flatten_body
from app.services.render_markdown import body_blocks, render_blocks
from tests.papers.test_paper_render import example

STUDY = ["assess-paper", "review-paper", "make-notation", "make-journal-club"]


@pytest.mark.parametrize("name", STUDY)
def test_every_cited_span_survives_flattening(name):
    body = example(name)

    blocks = body_blocks(body)

    kept = {s["text"] for s in leaf_spans(blocks) if s["cites"]}
    assert kept == {s["text"] for s in leaf_spans(body)} | {
        s["meaning"] for s in body.get("symbols", [])
    } | {s["symbol_latex"] for s in body.get("symbols", [])}


def headings(name: str) -> list[str]:
    return [b["text"] for b in body_blocks(example(name)) if b["type"] == "heading"]


def test_an_assessment_renders_scores_checklist_and_shelf_links():
    markdown = render_blocks(body_blocks(example("assess-paper")))

    assert headings("assess-paper") == [
        "Assessment", "Scores", "Reproducibility", "Related on your shelf",
    ]  # fmt: skip
    assert "**Novelty: 3/5.**" in markdown
    assert "**Statistical significance: no.**" in markdown
    assert "**izacard-fid:**" in markdown


def test_a_review_renders_severity_and_the_verdict():
    markdown = render_blocks(body_blocks(example("review-paper")))

    assert headings("review-paper") == [
        "Summary", "Strengths", "Weaknesses", "Questions for the authors",
        "Missing experiments", "Verdict",
    ]  # fmt: skip
    assert "**Major:**" in markdown
    assert "**Weak accept (confidence 4/5).**" in markdown


def test_a_notation_table_is_a_symbol_meaning_table():
    blocks = body_blocks(example("make-notation"))

    table = next(b for b in blocks if b["type"] == "table")
    assert table["header"] == ["Symbol", "Meaning"]
    assert table["rows"][3][0] == {
        "text": "g_i", "cites": ["ch03/s01/m001", "ch03/s01/p002"], "mark": "code",
    }  # fmt: skip
    assert "Gate score of passage i" in flatten_body(example("make-notation"))


def test_a_journal_club_numbers_its_five_questions():
    blocks = body_blocks(example("make-journal-club"))

    steps = next(b for b in blocks if b["type"] == "steps")
    assert len(steps["items"]) == 5
    assert headings("make-journal-club") == [
        "Pitch", "The figure to show", "Weakest assumption", "Discussion questions", "Debate",
    ]  # fmt: skip
    assert "**Against:**" in render_blocks(blocks)


def test_the_study_types_are_searchable():
    kinds = {ArtifactType.PAPER_ASSESSMENT, ArtifactType.PAPER_REVIEW,
             ArtifactType.NOTATION_TABLE, ArtifactType.JOURNAL_CLUB}  # fmt: skip
    assert kinds <= INDEXED_TYPES
    assert "within the ±0.4 standard deviation" in flatten_body(example("review-paper"))

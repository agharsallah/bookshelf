"""Paper bodies flatten into render blocks for exports, search indexing and hits."""

import json
from typing import Any

from app.core.config import get_settings
from app.pipeline.bodies import leaf_spans
from app.retrieval.points import flatten_body
from app.services.render_markdown import body_blocks, render_blocks


def example(name: str) -> dict[str, Any]:
    return json.loads((get_settings().skills_dir / name / "example.json").read_text())


def test_every_cited_span_of_a_card_survives_flattening():
    card = example("dissect-paper")

    blocks = body_blocks(card)

    kept = {s["text"] for s in leaf_spans(blocks) if s["cites"]}
    assert kept == {s["text"] for s in leaf_spans(card)}
    headings = [b["text"] for b in blocks if b["type"] == "heading"]
    assert headings[:5] == ["TL;DR", "Question", "Contributions", "Method", "Setup"]
    assert "Key numbers" in headings  # the guide's `numbers` rendering, shared


def test_a_card_is_searchable_by_its_tldr_and_setup():
    text = flatten_body(example("dissect-paper"))

    assert "Gated retrieval adapters score each retrieved passage" in text
    assert "Re-run with the authors' released code." in text


def test_an_explainer_renders_its_equations_as_math_with_their_reading():
    explainer = example("simplify-paper")

    markdown = render_blocks(body_blocks(explainer))

    assert "g_i = \\sigma(w^\\top [q; p_i])" in markdown
    assert "The equations in words" in markdown
    assert {s["text"] for s in leaf_spans(body_blocks(explainer)) if s["cites"]} == {
        s["text"] for s in leaf_spans(explainer)
    }


def test_other_bodies_are_untouched():
    brief = {"blocks": [{"type": "paragraph", "spans": [{"text": "x", "cites": ["ch01/p001"]}]}]}

    assert body_blocks(brief) == brief["blocks"]

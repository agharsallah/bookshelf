"""Render-contract blocks to Markdown: every block type, marks, cites, escaping."""

import json
from pathlib import Path
from typing import Any

import pytest

from app.services.render_markdown import RENDERERS, body_blocks, render_block, render_blocks

CONTRACT = Path(__file__).resolve().parents[3] / "contracts" / "render-blocks.schema.json"


def span(text: str, *cites: str, mark: str | None = None) -> dict[str, Any]:
    return {"text": text, "cites": list(cites), **({"mark": mark} if mark else {})}


def test_every_contract_block_type_has_a_renderer():
    schema = json.loads(CONTRACT.read_text())
    types = {ref["$ref"].rsplit("/", 1)[-1] for ref in schema["$defs"]["block"]["oneOf"]}

    assert set(RENDERERS) == types


CASES: dict[str, tuple[dict[str, Any], str]] = {
    "heading": ({"type": "heading", "level": 3, "text": "Stocks"}, "### Stocks"),
    "paragraph": (
        {
            "type": "paragraph",
            "spans": [
                span("A stock", "ch01/p001", mark="strong"),
                span("changes", mark="em"),
                span("slowly", mark="highlight"),
                span("x`y", mark="code"),
            ],
        },
        "**A stock** <sup>[ch01/p001](#ch01/p001)</sup> *changes* <mark>slowly</mark> ``x`y``",
    ),
    "bullets": (
        {"type": "bullets", "items": [[span("one")], [span("two", "ch01/p002")]]},
        "- one\n- two <sup>[ch01/p002](#ch01/p002)</sup>",
    ),
    "steps": ({"type": "steps", "items": [[span("fill")], [span("drain")]]}, "1. fill\n2. drain"),
    "table": (
        {
            "type": "table",
            "caption": "Loops",
            "header": ["Kind", "Effect"],
            "rows": [[span("balancing"), span("a | b\nc", "ch02/t001")]],
        },
        "*Loops*\n\n| Kind | Effect |\n| --- | --- |\n"
        "| balancing | a \\| b<br>c <sup>[ch02/t001](#ch02/t001)</sup> |",
    ),
    "chart": (
        {
            "type": "chart",
            "kind": "line",
            "title": "Level",
            "x": {"label": "t", "values": [0, 1]},
            "y": {"label": "litres"},
            "series": [{"name": "tub", "values": [1.0, None]}],
            "cites": ["ch02/f001"],
            "confidence": "high",
        },
        "*Level (y: litres)* <sup>[ch02/f001](#ch02/f001)</sup> · confidence: high\n\n"
        "| t | tub |\n| --- | --- |\n| 0 | 1 |\n| 1 |  |",
    ),
    "diagram": (
        {
            "type": "diagram",
            "direction": "LR",
            "nodes": [{"id": "a", "label": 'In "flow"'}, {"id": "b", "label": "Stock"}],
            "edges": [{"from": "a", "to": "b", "label": "fills"}],
            "cites": [],
        },
        '```mermaid\nflowchart LR\n  a["In #quot;flow#quot;"]\n  b["Stock"]\n'
        '  a -->|"fills"| b\n```',
    ),
    "callout": (
        {"type": "callout", "tone": "antipattern", "title": "Oops", "spans": [span("Do not.")]},
        "> [!WARNING]\n> **Antipattern: Oops**\n> Do not.",
    ),
    "code": (
        {"type": "code", "language": "py", "text": "a = '```'\n", "cites": []},
        "````py\na = '```'\n````",
    ),
    "math": (
        {"type": "math", "latex": "x^2", "meaning": [span("x squared")], "cites": ["ch03/m001"]},
        "$$\nx^2\n$$ <sup>[ch03/m001](#ch03/m001)</sup>\n\nx squared",
    ),
    "quote": (
        {
            "type": "quote",
            "text": "Line one\nLine two",
            "attribution": "Meadows",
            "page": 12,
            "cites": ["ch01/q001"],
        },
        "> Line one\n> Line two\n>\n> — Meadows, p. 12 <sup>[ch01/q001](#ch01/q001)</sup>",
    ),
    "definition": (
        {"type": "definition", "term": "Stock", "spans": [span("an accumulation")]},
        "**Stock**: an accumulation",
    ),
}


@pytest.mark.parametrize("block_type", sorted(CASES))
def test_block_renders_to_markdown(block_type: str):
    block, expected = CASES[block_type]

    assert render_block(block) == expected


def test_blocks_are_separated_by_blank_lines_and_unknown_types_are_flagged():
    rendered = render_blocks([CASES["heading"][0], {"type": "video"}])

    assert rendered == "### Stocks\n\n<!-- unsupported block type: 'video' -->"


def test_brief_sections_and_takeaways_become_blocks():
    body = {
        "sections": [{"key": "thesis", "title": "Thesis", "blocks": [CASES["heading"][0]]}],
        "takeaway": span("Delays matter.", "ch02/f001"),
    }

    assert body_blocks(body) == [
        {"type": "heading", "level": 3, "text": "Thesis"},
        CASES["heading"][0],
        {"type": "paragraph", "spans": [span("Delays matter.", "ch02/f001")]},
    ]


def test_quiz_faq_and_flashcard_items_render():
    body = {
        "items": [
            {
                "question": "Which?",
                "choices": ["a", "b"],
                "answer": 1,
                "explanation": [span("Because b.")],
            },
            {"question": "Why?", "answer": [span("Feedback.")]},
            {"front": "Stock", "back": [span("An accumulation.")]},
        ]
    }

    assert render_blocks(body_blocks(body)) == (
        "#### Which?\n\n1. a\n2. b ✓\n\nBecause b.\n\n"
        "#### Why?\n\nFeedback.\n\n"
        "**Stock**: An accumulation."
    )


def test_guide_journey_themes_and_numbers_become_headed_lists():
    body = {
        "sections": [{"key": "overview", "title": "The book in brief", "blocks": []}],
        "journey": [
            {"anchor": "ch01", "role": "setup", "takeaway": [span("Frames it.", "ch01/p001")]}
        ],
        "themes": [{"name": "Flow", "spans": [span("Returns.", "ch01/p002", "ch02/p001")]}],
        "numbers": [{"value": "80%", "label": [span("Threshold.", "ch02/p003")]}],
    }

    assert render_blocks(body_blocks(body)) == (
        "### The book in brief\n\n"
        "### Chapter by chapter\n\n"
        "- **ch01 (setup)** Frames it. <sup>[ch01/p001](#ch01/p001)</sup>\n\n"
        "### Themes\n\n"
        "- **Flow.** Returns. <sup>[ch01/p002](#ch01/p002), [ch02/p001](#ch02/p001)</sup>\n\n"
        "### Key numbers\n\n"
        "- **80%:** Threshold. <sup>[ch02/p003](#ch02/p003)</sup>"
    )

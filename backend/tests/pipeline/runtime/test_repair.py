"""Render-block shape repair: the slips small models make, fixed without losing a word."""

import copy

import pytest

from app.pipeline import gates
from app.pipeline.repair import repair_blocks
from tests.pipeline.runtime.conftest import body, paragraph, span

BLOCKS = {"$ref": f"{gates.RENDER_BLOCKS_ID}#/$defs/blocks"}
CELL_CITES = ("ch14/p001", "ch14/p002")
SAVED, TEN_K = span("Saved", CELL_CITES[0]), span("$10k", CELL_CITES[1])
SCHEMA = {"type": "object", "required": ["blocks"], "properties": {"blocks": BLOCKS}}


@pytest.mark.parametrize(
    ("slipped", "repaired", "fix"),
    [
        (
            {"type": "paragraph", "text": "A ship.", "cites": ["ch21/f003"]},
            paragraph("A ship.", "ch21/f003"),
            "paragraph: text → spans",
        ),
        (
            {"type": "bullets", "items": [span("Scope", "ch04/p001"), "Ownership",
                                          {"spans": [span("Work first", "ch05/p028")]}]},
            {"type": "bullets", "items": [[span("Scope", "ch04/p001")], [span("Ownership")],
                                          [span("Work first", "ch05/p028")]]},
            "bullets: items → lists of spans",
        ),
        (
            {"type": "paragraph", "items": [[span("Decode", "ch02/l001")]]},
            {"type": "bullets", "items": [[span("Decode", "ch02/l001")]]},
            "paragraph with items → bullets",
        ),
        (
            {"type": "table", "header": ["Story", "Result"], "confidence": "high",
             "rows": [[[span("PM conflict", "ch14/f001")], [SAVED, TEN_K]]]},
            {"type": "table", "header": ["Story", "Result"],
             "rows": [[span("PM conflict", "ch14/f001"), span("Saved $10k", *CELL_CITES)]]},
            "table: cells → spans",
        ),
        (
            {"type": "important", "spans": [span("Read the job description.", "ch04/p003")]},
            {"type": "callout", "tone": "important",
             "spans": [span("Read the job description.", "ch04/p003")]},
            "important → callout tone",
        ),
        (
            {"type": "bullets", "spans": [span("Scope", "ch04/p001"), span("Ownership")]},
            {"type": "bullets", "items": [[span("Scope", "ch04/p001")], [span("Ownership")]]},
            "bullets: spans → one item each",
        ),
        (
            {"type": "table", "header": [span("Story", "ch14/f001"), "Result"], "rows": []},
            {"type": "table", "header": ["Story", "Result"], "rows": []},
            "table: header spans → strings",
        ),
        (
            {"type": "diagram", "cites": ["ch03/f001"], "nodes": [{"id": "a", "label": "A"},
             {"id": "b", "label": "B"}], "edges": [{"source": "a", "target": "b", "label": "x"}]},
            {"type": "diagram", "cites": ["ch03/f001"], "nodes": [{"id": "a", "label": "A"},
             {"id": "b", "label": "B"}], "edges": [{"from": "a", "to": "b", "label": "x"}]},
            "diagram: source/target → from/to",
        ),
        (
            {"type": "steps", "cites": ["ch04/s01/p002"],
             "items": [[span("Mask 15% of tokens")], [span("Predict them", "ch04/s01/p003")]]},
            {"type": "steps", "items": [[span("Mask 15% of tokens", "ch04/s01/p002")],
                                        [span("Predict them", "ch04/s01/p003")]]},
            "steps: block cites → its spans",
        ),
        (
            {"type": "heading", "level": 3, "text": "Pre-training", "cites": ["ch04/s01"]},
            {"type": "heading", "level": 3, "text": "Pre-training"},
            "heading: block cites → its spans",
        ),
        (
            {"type": "heading", "level": 2, "spans": [span("Pre-training", "ch04/s01")]},
            {"type": "heading", "level": 2, "text": "Pre-training"},
            "heading: spans → text",
        ),
    ],
    ids=["paragraph-text", "bullet-items", "paragraph-items", "table-cells", "tone-as-type",
         "bullets-with-spans", "header-spans", "diagram-edge-aliases", "steps-block-cites",
         "heading-cites", "heading-spans"],
)  # fmt: skip
def test_slips_are_repaired_into_valid_blocks(slipped, repaired, fix):
    output = {"blocks": [slipped]}
    assert gates.schema_errors(SCHEMA, output) != []

    fixes = repair_blocks(output)

    assert output == {"blocks": [repaired]}
    assert fix in fixes
    assert gates.schema_errors(SCHEMA, output) == []


def test_confidence_is_dropped_only_where_the_contract_forbids_it():
    chart = {"type": "chart", "kind": "bar", "series": [], "cites": [], "confidence": "low"}
    output = {"blocks": [{"type": "table", "header": ["a"], "rows": [], "confidence": "x"}, chart]}

    fixes = repair_blocks(output)

    assert "confidence" not in output["blocks"][0]
    assert output["blocks"][1]["confidence"] == "low"
    assert fixes == ["table: dropped confidence"]


def test_valid_output_is_left_untouched():
    output = body(paragraph("Scope beats recency.", "ch05/p020"), confidence="high")
    before = copy.deepcopy(output)

    assert repair_blocks(output) == []
    assert output == before


def test_blocks_nested_anywhere_are_repaired():
    output = {"sections": [{"key": "thesis", "blocks": [{"type": "paragraph", "text": "CARL."}]}]}

    repair_blocks(output)

    assert output["sections"][0]["blocks"] == [paragraph("CARL.")]

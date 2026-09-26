"""§14 gates: hard (schema, anchors) and soft (grounding, compression, words, confidence,
verbatim code, duplication), plus the human bypass."""

import pytest

from app.models.enums import Origin, Review
from app.pipeline import bodies, gates
from app.pipeline.skills import GateConfig
from tests.pipeline.runtime.conftest import body, paragraph, span

VALID = {"ch01/p001", "ch01/p002", "ch01/f001"}
NO_GATES = GateConfig(grounding_min=0)


def test_grounding_is_the_share_of_leaf_spans_citing_a_valid_anchor():
    output = {
        "blocks": [
            paragraph("cited", "ch01/p001"),
            paragraph("uncited"),
            {"type": "bullets", "items": [[span("nested", "ch01/p002")], [span("bad", "ch09/p1")]]},
        ],
        "takeaway": span("top-level span", "ch01/f001"),
    }

    assert gates.grounding_score(output, VALID) == pytest.approx(3 / 5)


def test_grounding_is_undefined_without_spans():
    assert gates.grounding_score({"chapters": []}, VALID) is None


def test_grounding_below_the_minimum_flags_for_review():
    output = body(paragraph("one", "ch01/p001"), paragraph("two"))

    report = gates.evaluate(
        output, config=GateConfig(grounding_min=0.9), valid_anchors=VALID, source_words=0
    )

    assert report.grounding == 0.5
    assert report.flags == ["grounding_below_min"]
    assert report.review is Review.NEEDS_REVIEW


def test_fully_grounded_output_is_a_draft():
    report = gates.evaluate(
        body(paragraph("one", "ch01/p001")),
        config=GateConfig(),
        valid_anchors=VALID,
        source_words=0,
    )

    assert report.flags == []
    assert report.review is Review.DRAFT


def test_invalid_anchors_are_found_in_cites_evidence_and_node_endpoints():
    output = {
        "blocks": [paragraph("x", "ch01/p001", "ch07/p001")],
        "edges": [
            {
                "src": {"kind": "node", "ref": "ch08/p001"},
                "dst": {"kind": "concept", "ref": "stock"},
                "evidence": ["ch01/p002", "ch09/p009"],
            }
        ],
    }

    assert gates.invalid_anchors(output, VALID) == ["ch07/p001", "ch08/p001", "ch09/p009"]


def test_hard_gate_reports_schema_and_anchor_problems():
    schema = {"$ref": gates.RENDER_BLOCKS_ID}
    output = body({"type": "paragraph"}, paragraph("ghost", "ch05/p001"))

    problems = gates.output_problems(schema, output, VALID)

    assert problems == [
        "schema: blocks/0: 'spans' is a required property",
        "anchors: cited anchors do not exist in this document: ch05/p001",
    ]


def test_schema_refs_resolve_through_the_render_contract_registry():
    schema = {"$ref": f"{gates.RENDER_BLOCKS_ID}#/$defs/span"}

    assert gates.schema_errors(schema, span("ok", "ch01/p001")) == []
    assert gates.schema_errors(schema, {"text": "no cites"}) == [
        "schema: <root>: 'cites' is a required property"
    ]


def test_an_anyof_block_list_reports_what_is_wrong_in_the_block_type_meant():
    """A skill's own block subset is an `anyOf`; the retry must name the fix ("spans"),
    not say the block matches none of the schemas."""
    blocks = {"anyOf": [{"$ref": f"{gates.RENDER_BLOCKS_ID}#/$defs/{name}"}
                        for name in ("paragraph", "bullets", "table")]}  # fmt: skip
    schema = {"type": "object", "properties": {"blocks": {"type": "array", "items": blocks}}}

    problems = gates.schema_errors(schema, {"blocks": [{"type": "paragraph", "text": "A ship."}]})

    assert "schema: blocks/0: 'spans' is a required property" in problems
    assert not any("any of the given schemas" in p for p in problems)


@pytest.mark.parametrize(
    ("words", "flags"),
    [(9, ["compression_low"]), (10, []), (25, []), (26, ["compression_high"])],
)
def test_compression_band_is_inclusive(words, flags):
    output = body(paragraph(" ".join(["w"] * words), "ch01/p001"))
    config = GateConfig(grounding_min=0, compression=(0.10, 0.25))

    report = gates.evaluate(output, config=config, valid_anchors=VALID, source_words=100)

    assert report.compression == words / 100
    assert report.flags == flags


def test_max_words_is_a_hard_cap():
    output = body(paragraph("one two three four", "ch01/p001"))
    config = GateConfig(max_words=3)

    report = gates.evaluate(output, config=config, valid_anchors=VALID, source_words=0)

    assert report.words == 4
    assert report.flags == ["over_max_words"]


def test_low_confidence_needs_review():
    output = body(paragraph("maybe a bar chart", "ch01/f001"), confidence="low")

    report = gates.evaluate(output, config=NO_GATES, valid_anchors=VALID, source_words=0)

    assert report.flags == ["low_confidence"]


def test_code_citing_the_listing_must_be_verbatim():
    element = {"anchor": "ch01/p002", "kind": "code", "text": "x = 1\n"}
    rewritten = body({"type": "code", "text": "x=1", "cites": ["ch01/p002"]})
    verbatim = body({"type": "code", "text": "x = 1\n", "cites": ["ch01/p002"]})

    flagged = gates.evaluate(
        rewritten, config=NO_GATES, valid_anchors=VALID, source_words=0, element=element
    )
    clean = gates.evaluate(
        verbatim, config=NO_GATES, valid_anchors=VALID, source_words=0, element=element
    )

    assert flagged.flags == ["code_not_verbatim"]
    assert clean.flags == []


def test_quoting_skills_must_copy_the_block_they_cite():
    sources = {"ch01/p001": "Slack is not waste. It is capacity \u201cheld\u201d  in reserve."}
    config = GateConfig(grounding_min=0, verbatim=True)
    copied = body({"text": 'It is capacity "held" in\nreserve.', "cites": ["ch01/p001"]})
    invented = body({"text": "Slack is reserve capacity.", "cites": ["ch01/p001"]})

    def flags(output: dict, cfg: GateConfig = config) -> list[str]:
        return gates.evaluate(
            output, config=cfg, valid_anchors=VALID, source_words=0, sources=sources
        ).flags

    # Whitespace and typographic quotes aside, the text must be in the cited block.
    assert flags(copied) == []
    assert flags(invented) == ["not_verbatim"]
    assert gates.unquoted(invented, sources) == ["ch01/p001: Slack is reserve capacity."]
    # Only skills that quote are held to it.
    assert flags(invented, GateConfig(grounding_min=0)) == []


def test_block_texts_reads_the_input_blocks():
    inputs = {
        "blocks": [{"anchor": "ch01/p001", "text": "A."}, {"anchor": "ch01/f001", "text": None}]
    }
    assert gates.block_texts(inputs) == {"ch01/p001": "A."}
    assert gates.block_texts({"chapter_distillations": []}) == {}


def test_duplication_flags_siblings_that_repeat_the_same_text():
    text = "a stock is the memory of the history of changing flows within the system"
    siblings = {
        "ch01/s02": text + " again",
        "ch01/s03": "flows are rates measured per unit of time entirely unrelated words here",
    }

    report = gates.evaluate(
        body(paragraph(text, "ch01/p001")),
        config=NO_GATES,
        valid_anchors=VALID,
        source_words=0,
        siblings=siblings,
    )

    assert report.flags == ["duplicate_of:ch01/s02"]


def test_jaccard_of_word_shingles():
    a = gates.shingles("one two three four")
    b = gates.shingles("two three four five")

    assert gates.jaccard(a, b) == pytest.approx(1 / 3)
    assert gates.jaccard(set(), b) == 0.0


def test_human_origin_bypasses_the_soft_gates():
    output = body(paragraph("uncited human words"), confidence="low")

    report = gates.evaluate(
        output,
        config=GateConfig(grounding_min=0.9, compression=(0.1, 0.2), max_words=1),
        valid_anchors=VALID,
        source_words=10,
        origin=Origin.HUMAN,
    )

    assert report.as_json() == {
        "grounding": None,
        "compression": None,
        "words": 3,
        "flags": [],
        "schema_retry": False,
        "repairs": [],
        "coverage": None,
        "uncovered": [],
    }


# --- Spoken length: `words_per_minute` against the run's `minutes` ------------------------

PACE = GateConfig(grounding_min=0, words_per_minute=(115, 185))


def spoken(words: int, minutes: float | None, config: GateConfig = PACE) -> gates.GateReport:
    output = body(paragraph(" ".join(["w"] * words), "ch01/p001"))
    return gates.evaluate(
        output, config=config, valid_anchors=VALID, source_words=0, minutes=minutes
    )


@pytest.mark.parametrize(
    ("words", "flags"),
    [
        (229, ["too_short_to_fill"]),
        (230, []),
        (370, []),
        (371, ["too_long_to_fit"]),
    ],
)
def test_words_per_minute_band_is_inclusive(words, flags):
    report = spoken(words, minutes=2)

    assert report.pace == words / 2
    assert report.flags == flags
    assert report.as_json()["pace"] == words / 2


@pytest.mark.parametrize(
    ("minutes", "config"), [(None, PACE), (5, NO_GATES)], ids=["no-minutes", "no-band"]
)
def test_a_run_without_minutes_or_a_skill_without_a_band_has_no_pace(minutes, config):
    report = spoken(10, minutes=minutes, config=config)

    assert (report.pace, report.flags) == (None, [])
    assert "pace" not in report.as_json()


def test_chinese_characters_count_as_a_share_of_a_spoken_word():
    assert bodies.spoken_words("hello 世界你好") == pytest.approx(1 + 4 * 0.6)
    assert bodies.spoken_words("AI很好") == pytest.approx(1 + 2 * 0.6)  # not one \w+ run
    assert bodies.spoken_words("Stocks and flows.") == 3

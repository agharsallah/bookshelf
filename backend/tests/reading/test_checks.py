"""compose-reading: the edition's parts follow the chapters it was offered."""

import json
from pathlib import Path

from app.pipeline.selectors import Selection
from app.reading.checks import check_reading_edition

ROOT = Path(__file__).resolve().parents[3]
EXAMPLE = json.loads((ROOT / "skills" / "compose-reading" / "example.json").read_text())


def selection(*anchors: str) -> Selection:
    return Selection(
        inputs={"chapters": [{"anchor": anchor} for anchor in anchors]},
        source_words=0,
        valid_anchors=frozenset(),
    )


def test_the_example_matches_a_single_chapter():
    assert check_reading_edition(EXAMPLE, selection("ch01")) == []


def test_chapters_out_of_order_are_refused():
    problems = check_reading_edition(EXAMPLE, selection("ch02", "ch01"))

    assert any("ch02, ch01" in problem for problem in problems)


def test_a_see_target_must_be_another_part():
    output = json.loads(json.dumps(EXAMPLE))
    output["parts"][1]["see"] = ["ch09"]

    problems = check_reading_edition(output, selection("ch01"))

    assert problems == ["ch01: see names ch09, which is not another part"]


def two_chapter_edition() -> dict:
    output = json.loads(json.dumps(EXAMPLE))
    second = json.loads(json.dumps(output["parts"][1]))
    second["id"] = "ch02"
    output["parts"].insert(2, second)
    output["parts"][-1]["see"] = ["ch01", "ch02"]
    return output


def test_two_chapters_in_order_with_connections_naming_both_pass():
    assert check_reading_edition(two_chapter_edition(), selection("ch01", "ch02")) == []


def test_the_through_line_must_send_the_reader_into_a_chapter():
    output = json.loads(json.dumps(EXAMPLE))
    output["parts"][0]["see"] = ["connections"]

    problems = check_reading_edition(output, selection("ch01"))

    assert problems == ["through-line: see must name a chapter part to open next"]


def test_connections_must_name_the_chapters_an_idea_returns_in():
    output = two_chapter_edition()
    output["parts"][-1]["see"] = ["ch01", "through-line"]

    problems = check_reading_edition(output, selection("ch01", "ch02"))

    assert problems == [
        "connections: see must name the chapter parts the ideas return in (at least 2)"
    ]

"""From a script to what the speech model reads: words only, one clip per speaker, and a
spoken AI disclosure first."""

from pathlib import Path

import pytest

from app.audio.speech import (
    ScriptError,
    Section,
    Turn,
    build_request,
    default_cast,
    default_voices,
)
from tests.audio.conftest import TWO_HOSTS
from tests.pipeline.runtime.conftest import script, section, turn

CLIPS = (Path("/voices/a.wav"), Path("/voices/b.wav"))


def test_the_request_is_the_words_by_zero_based_speaker_with_the_disclosure_first():
    request = build_request(TWO_HOSTS, CLIPS, title="Thinking in Systems")

    assert request.voices == CLIPS
    assert request.sections == (
        Section(
            "Stocks",
            (
                Turn(
                    0,
                    "This is an AI-generated audio summary of Thinking in Systems. "
                    "A stock is memory.",
                ),
                Turn(1, "Of what?"),
            ),
        ),
        Section("Flows", (Turn(0, "Of its flows."),)),
    )


def test_a_chinese_script_opens_with_the_chinese_disclosure():
    request = build_request(TWO_HOSTS, CLIPS, title="系统之美", language="zh")

    opening = request.sections[0].turns[0].text
    assert opening == "这是一段由人工智能生成的《系统之美》音频摘要。 A stock is memory."


def test_empty_turns_turns_of_undeclared_speakers_and_empty_sections_are_dropped():
    body = script(
        section("Silence", turn(1, "  **  "), turn(3, "A third voice nobody cast.")),
        section("`Loops`", turn(2, "Loops  seek\ngoals.")),
    )

    request = build_request(body, CLIPS, title="T")

    spoken = "This is an AI-generated audio summary of T. Loops seek goals."
    assert request.sections == (Section("Loops", (Turn(1, spoken),)),)


@pytest.mark.parametrize(
    ("body", "clips", "problem"),
    [
        (TWO_HOSTS, CLIPS[:1], "2 speakers but 1 voices"),
        (script(speakers=0), (), "declares no speakers"),
        (script(section("Empty", turn(1, "#")), speakers=1), CLIPS[:1], "nothing to say"),
    ],
    ids=["voice-count-mismatch", "no-speakers", "nothing-to-say"],
)
def test_a_script_that_cannot_be_spoken_is_refused(body, clips, problem):
    with pytest.raises(ScriptError, match=problem):
        build_request(body, clips, title="T")


def test_the_default_cast_is_the_languages_voices_in_order():
    assert default_cast(3, "zh") == ["xinran", "bowen", "anchen"]
    assert default_cast(2, "fr") == ["alice", "frank"]  # unknown language: English
    assert default_voices("narrator", "en") == ["alice"]
    assert default_voices("roundtable", "en") == ["alice", "frank", "maya", "carter"]

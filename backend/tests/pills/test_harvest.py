"""Harvesters over real skill outputs (`skills/*/example.json`): pure, no database."""

import uuid
from typing import Any

from app.audio.store import Mark, Render
from app.models.enums import ArtifactType, PillKind
from app.papers.claims import claim_id
from app.pills.contract import BODY_MODELS
from app.pills.harvest import HARVESTERS, PillDraft, harvest_document
from app.pills.harvest.base import est_seconds, source_key
from tests.pills.fixtures import DOC_ID, context, example, harvest_input, source


def run(type: ArtifactType, body: dict[str, Any], *, anchor: str | None = None, **ctx: Any):
    pills = HARVESTERS[type](harvest_input(type, body, anchor=anchor, **ctx))
    for pill in pills:  # every body fits its kind's contract
        BODY_MODELS[pill.kind].model_validate(pill.body)
    return pills


def kinds(pills: list[PillDraft]) -> list[str]:
    return [p.kind.value for p in pills]


def callout(tone: str, text: str) -> dict[str, Any]:
    return {"type": "callout", "tone": tone, "spans": [{"text": text, "cites": ["ch02/p001"]}]}


# --- Distillations -----------------------------------------------------------------------


def test_a_chapter_distillation_yields_its_callouts_and_diagram_in_order():
    pills = run(ArtifactType.CHAPTER_DISTILLATION, example("distil-chapter"), anchor="ch03")

    assert kinds(pills) == ["insight", "diagram", "antipattern", "remember"]
    insight = pills[0]
    assert insight.anchor == "ch03"
    assert insight.cites == ["ch03/s01/p004", "ch03/s01/f001"]
    assert insight.origin == "harvest:chapter_distillation"
    assert insight.body["spans"][0]["text"].startswith("Busyness is not productivity")
    assert pills[1].body["diagram"]["nodes"][0] == {"id": "util", "label": "High utilization"}


def test_callouts_outside_the_word_bounds_or_of_other_tones_are_skipped():
    body = {
        "blocks": [
            callout("important", "Too short to teach."),
            callout("insight", " ".join(["word"] * 81)),
            callout("caution", "A caution leans on the paragraph it sits in, so it is skipped."),
            callout("insight", "Six words make one idea here."),
        ]
    }

    pills = run(ArtifactType.CHAPTER_DISTILLATION, body, anchor="ch02")

    assert [p.body["spans"][0]["text"] for p in pills] == ["Six words make one idea here."]


def test_a_diagram_takes_the_heading_above_it_as_headline():
    diagram = example("distil-chapter")["blocks"][1]
    body = {"blocks": [{"type": "heading", "level": 2, "text": "The curve"}, diagram]}

    (pill,) = run(ArtifactType.CHAPTER_DISTILLATION, body, anchor="ch03")

    assert pill.headline == "The curve"


def test_core_salience_marks_become_insights_with_their_reason():
    pills = run(ArtifactType.SALIENCE_MARKS, example("mark-salience"), anchor="ch03")

    assert kinds(pills) == ["insight", "insight"]
    assert pills[1].body["spans"] == [
        {
            "text": "If waiting is the price of busyness, slack is not waste.",
            "cites": ["ch03/s03/p001"],
        }
    ]
    assert pills[1].body["why"][0]["text"].startswith("The practical conclusion")


# --- Study material ----------------------------------------------------------------------


def test_quotes_keep_their_page_and_attribution():
    pills = run(ArtifactType.QUOTE_SET, example("extract-quotes"), anchor="ch03")

    assert kinds(pills) == ["quote"] * 5
    assert pills[1].body == {
        "text": "Below 70 percent the line is almost flat; past 80 it turns into a wall.",
        "page": 53,
        "attribution": "Ines Okafor",
    }


def test_every_quiz_item_is_an_active_pill():
    body = example("make-quiz")

    pills = run(ArtifactType.QUIZ, body, anchor="ch03")

    assert kinds(pills) == ["quiz"] * len(body["items"])
    assert pills[0].body["answer"] == body["items"][0]["answer"]
    assert pills[0].est_seconds == est_seconds(PillKind.QUIZ, pills[0].body)
    assert pills[0].est_seconds >= 18  # 8 s floor + 10 s for answering


def test_flashcards_keep_short_backs():
    pills = run(ArtifactType.FLASHCARDS, example("make-flashcards"), anchor="ch02")

    assert kinds(pills) == ["flip"] * 5
    assert pills[3].body["back"][0]["text"] == "About three weeks."


def test_glossary_terms_are_definitions_naming_their_concept():
    body = example("make-glossary")

    pills = run(ArtifactType.GLOSSARY, body)

    assert len(pills) == len(body["blocks"])
    assert pills[0].body["term"] == "flow efficiency"
    assert pills[0].concepts == ["flow efficiency"]
    assert pills[0].anchor == "ch06"  # a document-scope artifact: the unit of the first cite


# --- Guides, figures, papers -------------------------------------------------------------


def test_a_book_guide_yields_its_numbers_and_its_map():
    body = example("write-guide")

    pills = run(ArtifactType.BOOK_GUIDE, body)

    numbers = [p for p in pills if p.kind is PillKind.NUMBER]
    assert len(numbers) == len(body["numbers"])
    assert numbers[0].body["value"] == "~80%"
    assert numbers[0].anchor == "ch03"
    map_title = next(s["title"] for s in body["sections"] if s["key"] == "map")
    assert any(p.kind is PillKind.DIAGRAM and p.headline == map_title for p in pills)


def test_a_paper_card_yields_its_numbers():
    pills = run(ArtifactType.PAPER_CARD, example("dissect-paper"))

    assert kinds(pills)[:2] == ["number", "number"]
    assert pills[0].body["value"] == "+2.1 EM"


def test_a_figure_pill_shows_the_crop_through_the_media_route():
    body = example("describe-figure")
    crop = {"ch03/s01/f001": "okafor/ch03-f001.png"}

    (pill,) = run(ArtifactType.FIGURE_DESCRIPTION, body, anchor="ch03/s01/f001", figures=crop)

    assert pill.body["image_url"] == "media/okafor/ch03-f001.png"
    assert pill.body["caption"] == body["caption"]
    assert pill.body["takeaway"] == [body["takeaway"]]
    assert pill.anchor == "ch03"
    assert pill.cites[0] == "ch03/s01/f001"


def test_a_figure_without_a_crop_or_described_with_low_confidence_is_skipped():
    body = example("describe-figure")
    crop = {"ch03/s01/f001": "okafor/ch03-f001.png"}

    assert run(ArtifactType.FIGURE_DESCRIPTION, body, anchor="ch03/s01/f001") == []
    low = body | {"confidence": "low"}
    assert run(ArtifactType.FIGURE_DESCRIPTION, low, anchor="ch03/s01/f001", figures=crop) == []


def test_claims_count_the_accepted_relations_on_them():
    body = example("extract-claims")
    second = claim_id(DOC_ID, body["claims"][1]["text"])
    support = {second: {"supports": 2, "contradicts": 1}}

    pills = run(ArtifactType.CLAIM_SET, body, claim_support=support)

    assert kinds(pills) == ["claim"] * 4
    assert pills[1].body["support"] == {"supports": 2, "contradicts": 1, "extends": 0}
    assert pills[0].body["support"] == {"supports": 0, "contradicts": 0, "extends": 0}
    assert pills[1].body["claim_kind"] == "result"
    assert pills[1].anchor == "ch04"


def test_formulas_become_math_pills_with_their_try_it():
    body = example("explain-math")

    pills = run(ArtifactType.MATH_EXPLAINER, body)

    assert kinds(pills) == ["math"] * len(body["formulas"])
    first = pills[0]
    assert first.anchor == "ch03"
    assert first.body["name"] == "The trust score"
    assert (
        first.body["try_it"]["question"]
        == "If the raw score is exactly 0, what trust score comes out?"
    )
    assert first.est_seconds == est_seconds(PillKind.MATH, first.body)
    assert first.est_seconds >= 18  # an active pill


# --- Audio -------------------------------------------------------------------------------


def _render(artifact_id: uuid.UUID) -> Render:
    turns = tuple(
        Mark(start=float(i * 4), end=float(i * 4 + 4), section=s, turn=t)
        for i, (s, t) in enumerate([(0, 0), (0, 1), (0, 2), (1, 0), (1, 1), (1, 2)])
    )
    return Render(
        key="0123456789abcdef",
        document_id=str(DOC_ID),
        source=str(artifact_id),
        voices=("a", "b"),
        duration=24.0,
        sections=(),
        turns=turns,
    )


def test_a_voiced_turn_is_a_listen_clip_of_its_render():
    artifact_id = uuid.UUID(int=7)  # `fixtures.source` id
    renders = {str(artifact_id): _render(artifact_id)}

    pills = run(ArtifactType.AUDIO_SUMMARY, example("write-audio-summary"), renders=renders)

    assert kinds(pills) == ["listen"] * 6
    third = pills[2]
    assert third.body["audio_url"] == f"audio/files/{DOC_ID}/{artifact_id}/0123456789abcdef.mp3"
    assert (third.body["start_ms"], third.body["end_ms"]) == (8000, 12000)
    assert third.headline == "The busiest team on the floor"
    assert third.anchor == "ch02"
    assert third.est_seconds == 8  # the clip's own length, clamped


def test_a_script_never_voiced_yields_nothing():
    assert run(ArtifactType.AUDIO_SUMMARY, example("write-audio-summary")) == []


# --- pill_set ----------------------------------------------------------------------------


def _composed(kind: str, text: str, **body: Any) -> dict[str, Any]:
    spans = [{"text": text, "cites": ["ch03/s01/p001"]}]
    return {
        "kind": kind,
        "headline": text[:20],
        "body": body or {"spans": spans},
        "cites": ["ch03/s01/p001"],
    }


def test_a_pill_set_keeps_its_threads_in_order_and_skips_bad_pills():
    spans = [
        {
            "text": "Past 80% every percent of load costs a lot of waiting.",
            "cites": ["ch03/s01/p004"],
        }
    ]
    body = {
        "threads": [
            {
                "title": "Why busy teams are slow",
                "pills": [
                    _composed(
                        "hook", "Why is the busiest team the slowest?", spans=spans, payoff=spans
                    ),
                    _composed("number", "not a composable kind"),
                    _composed("insight", "Waiting explodes past eighty percent utilization."),
                    _composed("remember", "Keep a fifth of capacity free for the unexpected."),
                ],
            }
        ],
        "pills": [_composed("antipattern", "Planning to full capacity guarantees queues forever.")],
    }
    inp = harvest_input(ArtifactType.PILL_SET, body, anchor="ch03")
    inp = type(inp)(
        inp.context, source(ArtifactType.PILL_SET, body, anchor="ch03", skill_version="2")
    )

    pills = HARVESTERS[ArtifactType.PILL_SET](inp)

    assert kinds(pills) == ["hook", "insight", "remember", "antipattern"]
    assert [p.thread_index for p in pills] == [0, 1, 2, None]
    assert {p.thread_key for p in pills[:3]} == {pills[0].thread_key} != {None}
    assert pills[0].thread_title == "Why busy teams are slow"
    assert {p.origin for p in pills} == {"skill:make-pills@2"}


# --- The whole document ------------------------------------------------------------------


def test_harvest_document_keeps_an_idea_once_and_names_concepts():
    term = {
        "type": "definition",
        "term": "slack",
        "spans": [
            {
                "text": "Capacity held in reserve for the work nobody can predict.",
                "cites": ["ch03/s03/p001"],
            }
        ],
    }
    distillation = source(ArtifactType.CHAPTER_DISTILLATION, {"blocks": [term]}, anchor="ch03")
    glossary = source(ArtifactType.GLOSSARY, {"blocks": [term]}, id=uuid.UUID(int=8))
    ctx = context(concept_index={"ch03/s03/p001": ["slack", "queueing"]})

    pills = harvest_document(ctx, [glossary, distillation])

    (pill,) = pills
    assert pill.origin == "harvest:chapter_distillation"  # earlier in HARVESTERS order wins
    assert pill.concepts == ["slack", "queueing"]


def test_source_keys_are_stable_and_scoped():
    first = run(ArtifactType.QUIZ, example("make-quiz"), anchor="ch03")
    again = run(ArtifactType.QUIZ, example("make-quiz"), anchor="ch03")

    assert [p.source_key for p in first] == [p.source_key for p in again]
    assert len({p.source_key for p in first}) == len(first)
    assert source_key("harvest:quiz", DOC_ID, "ch03", "Q") != source_key(
        "harvest:quiz", DOC_ID, "ch04", "Q"
    )
    assert source_key("harvest:quiz", DOC_ID, "ch03", " q ") == source_key(
        "harvest:quiz", DOC_ID, "ch03", "Q"
    )


def test_est_seconds_reads_at_238_wpm_within_bounds():
    def spans(words: int) -> dict[str, Any]:
        return {"spans": [{"text": " ".join(["word"] * words), "cites": []}]}

    assert est_seconds(PillKind.INSIGHT, spans(238)) == 60
    assert est_seconds(PillKind.INSIGHT, spans(3)) == 8
    assert est_seconds(PillKind.INSIGHT, spans(1000)) == 90
    assert est_seconds(PillKind.REMEMBER, spans(119)) == 30


def test_draft_artifacts_make_draft_pills():
    inp = harvest_input(ArtifactType.QUIZ, example("make-quiz"), anchor="ch03")
    drafted = type(inp)(
        inp.context, source(ArtifactType.QUIZ, example("make-quiz"), anchor="ch03", draft=True)
    )

    assert all(not p.draft for p in HARVESTERS[ArtifactType.QUIZ](inp))
    assert all(p.draft for p in HARVESTERS[ArtifactType.QUIZ](drafted))

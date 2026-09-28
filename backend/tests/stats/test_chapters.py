"""Per-chapter figures: attribution by anchor prefix, normalized by the chapter's size."""

from app.models.enums import JobKind
from app.stats.chapters import ChapterIndex, chapter_stats
from tests.stats.builders import artifact, call, chapter, job


def test_anchors_belong_to_their_longest_chapter_prefix():
    index = ChapterIndex([chapter("ch01"), chapter("ch10"), chapter("pt01/ch01")])

    assert index.chapter_of("ch01/s02/p003") == "ch01"
    assert index.chapter_of("ch10") == "ch10"
    assert index.chapter_of("pt01/ch01/s01") == "pt01/ch01"
    assert index.chapter_of("ch011") is None  # a prefix of the text, not of the path
    assert index.chapter_of(None) is None


def test_chapter_cost_time_and_quality_are_summed_and_normalized():
    summary = job(JobKind.SUMMARIZE, anchor="ch01", minutes=2)
    section = job(JobKind.DISTIL_SECTION, anchor="ch01/s01", minutes=3)
    brief = job(JobKind.BRIEF, minutes=10)  # book-level: in no chapter
    distillation = artifact(
        "distil-chapter", type="chapter_distillation", anchor="ch01", compression=0.12,
        grounding=0.9, flags=("compression_low",), words=400,
    )  # fmt: skip

    [ch01] = chapter_stats(
        [chapter("ch01", words=2000, pages=5)],
        [summary, section, brief],
        [call(section, input_tokens=3000, output_tokens=1000)],
        [distillation, artifact(anchor="ch01", grounding=1.0, words=100)],
    )

    assert ch01.jobs.total == 2
    assert ch01.tokens == 1000 + 4000
    assert ch01.compute_ms == 5 * 60_000
    assert ch01.ms_by_kind == {"summarize": 120_000, "distil_section": 180_000}
    assert ch01.tokens_per_1k_words == 2500.0
    assert ch01.seconds_per_page == 60.0
    assert (ch01.grounding, ch01.compression, ch01.needs_review) == (0.95, 0.12, 1)
    assert ch01.words_out == 500

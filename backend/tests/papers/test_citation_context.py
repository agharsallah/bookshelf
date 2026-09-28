"""The sentence around an in-text citation (`papers.citation_context`): pure."""

# ruff: noqa: RUF001 - the en dash of a citation range is the point

from app.papers.citation_context import CONTEXT_MAX, context, sentences


def test_abbreviations_never_end_a_sentence():
    text = "As shown in Fig. 3 and by Vaswani et al. (2017), attention wins. We agree."

    assert sentences(text) == [
        "As shown in Fig. 3 and by Vaswani et al. (2017), attention wins.",
        "We agree.",
    ]


def test_a_numbered_marker_picks_its_sentence_among_many():
    text = (
        "Recurrent networks were long the default for sequence modelling tasks [1, 2]. "
        "We build directly on the gated attention mechanism introduced in [3–5]. "
        "Convolutional models are an alternative that we do not pursue here [6]."
    )

    assert context(text, ordinal=4, first_author=None, year=None) == (
        "We build directly on the gated attention mechanism introduced in [3–5]."
    )


def test_an_author_year_marker_matches_on_surname_and_year():
    text = (
        "Earlier work used recurrent encoders throughout (Sutskever et al., 2014). "
        "Our optimiser follows the recipe of Kingma and Ba (2015) with warm-up steps."
    )

    found = context(text, ordinal=9, first_author="Diederik P. Kingma", year=2015)

    assert found == "Our optimiser follows the recipe of Kingma and Ba (2015) with warm-up steps."
    assert context(text, ordinal=9, first_author="Diederik P. Kingma", year=2016) == " ".join(
        text.split()
    )  # no marker found: the passage itself


def test_a_long_passage_is_clipped():
    text = "word " * 300

    assert len(context(text, ordinal=1, first_author=None, year=None)) == CONTEXT_MAX

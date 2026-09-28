"""papers.citations: in-text markers → the anchors citing each reference."""

# ruff: noqa: RUF001

import time

import pytest

from app.papers.citations import author_year_cites, fold, link_citations, numeric_ordinals
from app.papers.refparse import ParsedReference


def _ref(ordinal: int, authors: list[str], year: int, label: str | None = None) -> ParsedReference:
    return ParsedReference(
        ordinal, "raw", None, authors=authors, year=year, year_label=label or str(year)
    )


@pytest.mark.parametrize(
    ("text", "ordinals"),
    [
        ("as shown [3].", [3]),
        ("prior work [3, 7] and [12]", [3, 7, 12]),
        ("see [3–5]", [3, 4, 5]),
        ("see [2, 7-9; 11]", [2, 7, 8, 9, 11]),
        ("the [CLS] token and x[i]", []),
    ],
)
def test_numeric_markers_expand_lists_and_ranges(text, ordinals):
    assert numeric_ordinals(text) == ordinals


def test_author_year_citations_are_found_in_every_form():
    text = (
        "ELMo (Peters et al., 2017, 2018a; Howard and Ruder, 2018) and Vaswani et al. (2017) "
        "and Radford et al. [2018] agree (e.g., Le and Mikolov, 2014)."
    )

    found = {(c.first, c.second, c.year) for c in author_year_cites(text)}

    assert found == {
        ("peters", None, "2017"),
        ("peters", None, "2018a"),
        ("howard", "ruder", "2018"),
        ("vaswani", None, "2017"),
        ("radford", None, "2018"),
        ("le", "mikolov", "2014"),
    }


def test_surnames_fold_accents_broken_diacritics_and_particles():
    assert fold("Täckström") == fold("T¨ackstr¨om") == "tackstrom"
    assert fold("Aaron van den Oord") == "oord"


def test_numbered_bibliographies_link_markers_to_the_ordinals_that_exist():
    refs = [_ref(1, ["Ada Lovelace"], 2017), _ref(2, ["Alan Turing"], 2018)]
    leaves = [
        ("ch01/p001", "Engines [1, 2] and [9]."),
        ("ch02/p001", "Again [2]."),
        ("ch02/p002", "[2]"),
    ]

    assert link_citations(leaves, refs, numbered=True) == {
        1: ["ch01/p001"],
        2: ["ch01/p001", "ch02/p001", "ch02/p002"],
    }


def test_year_suffixes_and_second_authors_pick_the_right_entry():
    refs = [
        _ref(1, ["Matthew Peters", "Waleed Ammar"], 2017),
        _ref(2, ["Matthew Peters", "Mark Neumann", "Mohit Iyyer"], 2018, "2018a"),
        _ref(3, ["Matthew Peters", "Mark Neumann", "Luke Zettlemoyer"], 2018, "2018b"),
        _ref(4, ["Alex Wang", "Amanpreet Singh"], 2018, "2018a"),
        _ref(5, ["Wei Wang", "Ming Yan"], 2018, "2018b"),
    ]
    leaves = [
        ("p1", "ELMo (Peters et al., 2018a)"),
        ("p2", "(Peters et al., 2018b; Wang et al., 2018a)"),
        ("p3", "Peters and Ammar (2017)"),
    ]

    cited = link_citations(leaves, refs, numbered=False)

    assert cited == {2: ["p1"], 3: ["p2"], 4: ["p2"], 1: ["p3"]}


def test_author_year_papers_ignore_bracketed_numbers():
    refs = [_ref(1, ["Ada Lovelace"], 2017)]

    assert link_citations([("p1", "vector [1] (Lovelace, 2017)")], refs, numbered=False) == {
        1: ["p1"]
    }


def test_a_long_title_case_leaf_is_scanned_in_linear_time():
    """Regression: an unbounded run of capitalised names made `_NARRATIVE` quadratic
    (30k characters of `Aaaa ` took seconds); a surname is at most four words."""
    started = time.perf_counter()
    assert author_year_cites("Aaaa " * 6000 + "Vaswani et al. (2017)")[0].first == "vaswani"
    assert time.perf_counter() - started < 0.5

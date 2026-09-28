"""papers.sections: section numbering, named headings and the role vocabulary."""

import pytest

from app.models.enums import SectionRole as R
from app.papers import sections


@pytest.mark.parametrize(
    ("heading", "lettered", "parts", "title"),
    [
        ("3 Model Architecture", False, ("3",), "Model Architecture"),
        (
            "3.2.1 Scaled Dot-Product Attention",
            False,
            ("3", "2", "1"),
            "Scaled Dot-Product Attention",
        ),
        ("4. Experiments", False, ("4",), "Experiments"),
        ("A.1 Illustration", True, ("A", "1"), "Illustration"),
    ],
)
def test_numbering_reads_the_section_number(heading, lettered, parts, title):
    num = sections.numbering(heading, lettered=lettered)

    assert num is not None and (num.parts, num.title) == (parts, title)


def test_letters_are_numbering_only_when_asked():
    assert sections.numbering("A Additional Details") is None
    assert sections.numbering("Attention") is None


def test_named_headings_ignore_case_numbering_and_appendix_labels():
    assert sections.is_named("REFERENCES")
    assert sections.is_named("Acknowledgments")
    assert sections.is_named("Appendix A: Proofs")
    assert not sections.is_named("Related Work")


def test_transformer_units_get_their_roles():
    headings = [
        "Abstract", "1 Introduction", "2 Background", "3 Model Architecture",
        "4 Why Self-Attention", "5 Training", "6 Results", "7 Conclusion",
        "Acknowledgements", "References", "Attention Visualizations",
    ]  # fmt: skip

    assert sections.role_for(headings) == [
        R.ABSTRACT, R.INTRODUCTION, R.BACKGROUND, R.METHOD, R.METHOD, R.EXPERIMENTS,
        R.RESULTS, R.CONCLUSION, R.OTHER, R.REFERENCES, R.APPENDIX,
    ]  # fmt: skip


def test_an_unnamed_section_after_the_results_is_not_the_method():
    roles = sections.role_for(
        ["1 Introduction", "2 BERT", "3 Experiments", "4 Tokens", "5 Limitations"]
    )

    assert roles == [R.INTRODUCTION, R.METHOD, R.EXPERIMENTS, R.OTHER, R.LIMITATIONS]


def test_everything_after_the_references_is_appendix():
    roles = sections.role_for(["1 Introduction", "References", "A Additional Results", "B Proofs"])

    assert roles[2:] == [R.APPENDIX, R.APPENDIX]


def test_references_and_acknowledgements_are_skipped_appendix_is_not():
    assert sections.skipped(R.REFERENCES, "References")
    assert sections.skipped(R.OTHER, "Acknowledgments")
    assert not sections.skipped(R.APPENDIX, "A Proofs")

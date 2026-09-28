"""MathML → TeX: annotations win, otherwise the presentation elements are translated."""

import pytest

from app.pipeline.parse.dom import parse_html
from app.pipeline.parse.mathml import is_display, mathml_to_tex


def _math(markup: str):
    root = parse_html(f"<html><body>{markup}</body></html>".encode())
    return next(el for el in root.iter() if el.tag == "math")


@pytest.mark.parametrize(
    ("markup", "tex"),
    [
        ("<math><msup><mi>x</mi><mn>2</mn></msup><mo>+</mo><mn>1</mn></math>", "x^2 + 1"),
        ("<math><msub><mi>a</mi><mrow><mi>i</mi><mo>+</mo><mn>1</mn></mrow></msub></math>",
         "a_{i + 1}"),
        ("<math><mfrac><mn>1</mn><mi>n</mi></mfrac></math>", r"\frac{1}{n}"),
        ("<math><mroot><mi>x</mi><mn>3</mn></mroot></math>", r"\sqrt[3]{x}"),
        ("<math><mi>sin</mi><mi>θ</mi><mo>≤</mo><mn>1</mn></math>", r"\sin \theta \leq 1"),
        ("<math><mover><mi>v</mi><mo>→</mo></mover></math>", r"\vec{v}"),
        ("<math><munderover><mo>∑</mo><mi>i</mi><mi>n</mi></munderover></math>", r"\sum_i^n"),
        ("<math><mfenced open='[' close=']'><mi>a</mi><mi>b</mi></mfenced></math>",
         r"\left[a, b\right]"),
        ('<math alttext="E = mc^2"><mi>E</mi></math>', "E = mc^2"),
        ('<math><semantics><mi>y</mi><annotation encoding="application/x-tex">y_0</annotation>'
         "</semantics></math>", "y_0"),
    ],
    ids=["sup", "sub-row", "frac", "root", "function-and-symbols", "accent", "big-operator",
         "fence", "alttext", "tex-annotation"],
)  # fmt: skip
def test_mathml_to_tex(markup: str, tex: str):
    assert mathml_to_tex(_math(markup)) == tex


def test_display_attribute_marks_block_math():
    assert is_display(_math('<math display="block"><mi>x</mi></math>'))
    assert not is_display(_math("<math><mi>x</mi></math>"))

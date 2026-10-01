"""describe-math's hard gate: the LaTeX it writes is one formula KaTeX can typeset."""

import copy
import json
from pathlib import Path
from typing import Any

import pytest

from app.papers import checks
from app.papers.latex_checks import latex_problems
from app.pipeline.selectors import Selection

EXAMPLE = Path(__file__).parents[3] / "skills" / "describe-math" / "example.json"
NO_SELECTION = Selection(inputs={}, source_words=0, valid_anchors=frozenset())


def _example() -> dict[str, Any]:
    return copy.deepcopy(json.loads(EXAMPLE.read_text(encoding="utf-8")))


def _with_latex(latex: str) -> dict[str, Any]:
    output = _example()
    output["latex"] = output["blocks"][0]["latex"] = latex
    return output


def test_the_example_passes():
    assert checks.problems("describe-math", _example(), NO_SELECTION) == []


@pytest.mark.parametrize("latex", [
    r"\left\{ x \mid x > 0 \right\}",
    r"\left. \frac{\partial f}{\partial x} \right|_{x=0}",
    r"\begin{cases} 1 & x > 0 \\ 0 & \text{otherwise} \end{cases}",
    r"\mathbb{D}_{KL}\left(\pi_\theta \| \pi_{ref}\right) = \frac{a}{b} - \log \frac{a}{b} - 1",
])  # fmt: skip
def test_balanced_formulas_pass(latex: str):
    assert latex_problems(latex) == []


# One piece of DeepSeek-R1's GRPO objective, transcribed as the parser cut it.
FRAGMENT = r"\left(\frac{\pi_\theta(o_i|q)}{\pi_{\theta_{old}}(o_i|q)} A_i, \text{clip}"


@pytest.mark.parametrize(("latex", "problem"), [
    (FRAGMENT, r"\left without"),
    (r"\frac{a}{b", "never closed"),
    (r"a}", "never opened"),
    (r"x \right)", r"\right has no \left"),
    (r"\begin{cases} 1 & x > 0 \end{array}", r"\end{array}"),
    (r"$E = mc^2$", "no $"),
    (r"E = mc^2 \tag{1}", "math mode only"),
    ("\\frac{a}{b} \text{clip}", "control character"),  # JSON "\text": a tab, then "ext"
])  # fmt: skip
def test_unbalanced_or_wrapped_formulas_are_refused(latex: str, problem: str):
    found = checks.problems("describe-math", _with_latex(latex), NO_SELECTION)

    assert any(problem in p for p in found), found


def test_the_math_block_repeats_the_transcription_verbatim():
    output = _example()
    output["blocks"][0]["latex"] = r"E[W_q] \approx \rho t_s"

    assert checks.problems("describe-math", output, NO_SELECTION) == [
        "blocks[0].latex: must be identical to the top-level latex"
    ]

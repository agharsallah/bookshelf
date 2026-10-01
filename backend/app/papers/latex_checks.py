"""Hard gates of describe-math (`checks.CHECKS["describe-math"]`): LaTeX the reader can typeset.

The reader renders `latex` with KaTeX, and one unbalanced group breaks the whole formula,
most often when a fragment of a larger formula is transcribed as it was cut
(`\\left(\\frac{a}{b}, \\text{clip}` opens a delimiter nothing closes). Each problem is
phrased for the model's one retry:

    same        `latex` and the leading `math` block's `latex` are identical
    balanced    every `{` closed, every `\\left` paired with a `\\right`, every `\\begin{…}`
                with its `\\end{…}`
    bare        math mode only: no `$`, `\\[ \\]`, `\\tag`, `\\label` or equation environment
    escaped     no control characters: a JSON string that spells `\\text` with one backslash
                decodes to a tab and `ext` (`\\frac` to a form feed, `\\nabla` to a newline)
"""

import re
from typing import Any

from app.pipeline.selectors import Selection

_TOKEN = re.compile(r"\\(left|right)(?![A-Za-z])|\\(begin|end)\{([^}]*)\}|\\.|[{}$]")
_CONTROL = re.compile(r"[\x00-\x1f]")
_WRAPPERS = re.compile(r"\\(?:\[|\]|tag|label)(?![A-Za-z])|\\begin\{(?:equation|align|gather)")


def latex_problems(latex: str) -> list[str]:
    """What keeps `latex` from typesetting as one math-mode formula."""
    problems: list[str] = []
    depth = delimiters = 0
    environments: list[str] = []
    for token in _TOKEN.finditer(latex):
        text, sizing, env_side, env = token.group(0), token.group(1), token.group(2), token.group(3)
        if text == "{":
            depth += 1
        elif text == "}":
            depth -= 1
            if depth < 0:
                problems.append("a } closes a group that was never opened")
                depth = 0
        elif text == "$":
            problems.append("no $: write math-mode LaTeX without delimiters")
        elif sizing == "left":
            delimiters += 1
        elif sizing == "right":
            delimiters -= 1
            if delimiters < 0:
                problems.append("a \\right has no \\left before it")
                delimiters = 0
        elif env_side == "begin":
            environments.append(env)
        elif env_side == "end" and (not environments or environments.pop() != env):
            problems.append(f"\\end{{{env}}} does not close the open environment")
    if depth:
        problems.append(f"{depth} {{ never closed")
    if delimiters:
        problems.append(
            f"{delimiters} \\left without a \\right: pair them, or write a plain ( [ for a "
            "delimiter this excerpt leaves open"
        )
    problems.extend(f"\\begin{{{env}}} never ended" for env in environments)
    if _CONTROL.search(latex):
        problems.append(
            "has a control character: in the JSON string write each LaTeX backslash twice "
            '("\\\\text", "\\\\frac"); one backslash turns \\t, \\f, \\n or \\b into a control code'
        )
    if _WRAPPERS.search(latex):
        problems.append("math mode only: no \\[ \\], \\tag, \\label or equation environment")
    return list(dict.fromkeys(problems))


def check_math_description(output: dict[str, Any], selection: Selection) -> list[str]:
    del selection  # the anchors were checked already; the LaTeX stands on its own
    latex = output["latex"]
    problems = [f"latex: {p}" for p in latex_problems(latex)]
    if output["blocks"][0]["latex"] != latex:
        problems.append("blocks[0].latex: must be identical to the top-level latex")
    return problems

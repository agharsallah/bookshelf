"""Cross-field hard gates of explain-math (`checks.CHECKS["explain-math"]`).

The schema guarantees the shape; these check what it cannot, each problem phrased for the
model's one retry:

    formulas     each anchor is a formula of the input (a `math` block of `blocks`, or the
                 prose a `distilled_formulas` entry cites), once; its `latex` matches the
                 source (whitespace, braces and spacing commands aside; an excerpt of a
                 multi-line source counts)
    symbols      every symbol the formula uses is explained (best effort: the letters and
                 Greek letters outside sub- and superscripts, `\\mathrm{…}` names and
                 words of three letters or more left out)
    arithmetic   every `a op b = c` in a worked example or an answer is right, to the
                 precision it is written in (`≈` allows one unit in the last place more)
    diagrams     node ids unique, every edge joins two nodes (the review editor's rule)
    cites        only anchors the input offered; shelf concepts from existing_concepts;
                 the path names only chosen formulas; a formula section stays digestible
"""

import ast
import operator
import re
from collections.abc import Callable, Iterable
from typing import Any

from app.pipeline.bodies import cited_anchors, count_words, leaf_spans
from app.pipeline.selectors import Selection

FORMULA_WORDS_MAX = 900  # a formula section a reader gets through in about five minutes

# --- LaTeX ------------------------------------------------------------------------------

_SPACING = re.compile(r"\\(?:left|right|big|Big|bigg|Bigg|displaystyle|[,;:! ]|q?quad)(?![A-Za-z])")


def latex_key(latex: str) -> str:
    """Two spellings of one formula share a key: no whitespace, braces, sizing or spacing
    commands, trailing punctuation."""
    key = _SPACING.sub("", latex)
    return re.sub(r"[\s{}]", "", key).rstrip(".,;")


def same_formula(written: str, source: str) -> bool:
    """`written` is `source`, or one line of it (a multi-line `align`)."""
    a, b = latex_key(written), latex_key(source)
    return bool(a) and (a == b or a in b or b in a)


GREEK = frozenset([
    "alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "zeta", "eta", "theta",
    "vartheta", "iota", "kappa", "lambda", "mu", "nu", "xi", "pi", "varpi", "rho", "varrho",
    "sigma", "varsigma", "tau", "upsilon", "phi", "varphi", "chi", "psi", "omega", "ell",
    "Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi", "Sigma", "Upsilon", "Phi", "Psi", "Omega",
])  # fmt: skip
_UNICODE_GREEK = dict(zip("αβγδεζηθικλμνξπρστυφχψωΓΔΘΛΞΠΣΥΦΨΩℓ", [
    "alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa",
    "lambda", "mu", "nu", "xi", "pi", "rho", "sigma", "tau", "upsilon", "phi", "chi", "psi",
    "omega", "Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi", "Sigma", "Upsilon", "Phi", "Psi",
    "Omega", "ell"], strict=True))  # fmt: skip
# Commands whose argument is a name, not symbols (`\mathrm{softmax}`, `\text{if}`).
_NAMED = frozenset(
    ["text", "mathrm", "operatorname", "textrm", "textit", "textbf", "mathtt", "mbox"]
)
_COMMAND = re.compile(r"\\([A-Za-z]+)")


def _skip_group(latex: str, i: int) -> int:
    """The index after the token at `i`: a `{…}` group, a `\\command`, or one character."""
    while i < len(latex) and latex[i].isspace():
        i += 1
    if i >= len(latex):
        return i
    if latex[i] == "{":
        depth = 0
        for j in range(i, len(latex)):
            depth += {"{": 1, "}": -1}.get(latex[j], 0)
            if depth == 0:
                return j + 1
        return len(latex)
    if match := _COMMAND.match(latex, i):
        end = match.end()
        return _skip_group(latex, end) if match.group(1) in _NAMED else end
    return i + 1


def symbol_atoms(latex: str) -> set[str]:
    """The symbols a formula uses: single letters and Greek letters, outside sub- and
    superscripts (indices and `^\\top` are part of the symbol they decorate). Letter runs
    of three or more (`softmax`, `Attention`) are names, not products of symbols."""
    atoms: set[str] = set()
    i = 0
    while i < len(latex):
        char = latex[i]
        if char == "\\":
            match = _COMMAND.match(latex, i)
            if match is None:
                i += 2
                continue
            name, i = match.group(1), match.end()
            if name in _NAMED:
                i = _skip_group(latex, i)
            elif name in GREEK:
                atoms.add(name)
        elif char in "_^":
            i = _skip_group(latex, i + 1)
        elif char in _UNICODE_GREEK:
            atoms.add(_UNICODE_GREEK[char])
            i += 1
        elif char.isascii() and char.isalpha():
            end = i
            while end < len(latex) and latex[end].isascii() and latex[end].isalpha():
                end += 1
            if end - i <= 2:
                atoms.update(latex[i:end])
            i = end
        else:
            i += 1
    return atoms


# --- Arithmetic ---------------------------------------------------------------------------

_OPS: dict[type, Callable[[float, float], float]] = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
}
# Written arithmetic: the minus, times, dot and division signs as well as ASCII ones.
_MINUS, _TIMES, _DOT, _DIVIDE = "\u2212", "\u00d7", "\u00b7", "\u00f7"
_OP_CHARS = rf"+\-{_MINUS}{_TIMES}*{_DOT}/{_DIVIDE}"
_LEFT = re.compile(rf"[\d.\s{_OP_CHARS}()]+$")
_RIGHT = re.compile(rf"\s*([-{_MINUS}]?\d+(?:\.\d+)?)(?!\s*[\d{_OP_CHARS}^(]|\.\d)")
_TO_PYTHON = str.maketrans({_MINUS: "-", _TIMES: "*", _DOT: "*", _DIVIDE: "/"})
_THOUSANDS = re.compile(r"(?<=\d),(?=\d{3}(?!\d))")


def _value(node: ast.expr) -> tuple[float, bool]:
    """(value, whether a binary operation was involved); ValueError when not arithmetic."""
    if isinstance(node, ast.Constant) and isinstance(node.value, int | float):
        return float(node.value), False
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
        value, binary = _value(node.operand)
        return -value, binary
    if isinstance(node, ast.BinOp) and type(node.op) in _OPS:
        (left, _), (right, _) = _value(node.left), _value(node.right)
        return _OPS[type(node.op)](left, right), True
    raise ValueError("not arithmetic")


def _evaluate(run: str) -> tuple[str, float] | None:
    """The longest tail of `run` that is arithmetic with a binary operation, and its value
    (`Step 2. 3 * 4` → `3 * 4`, 12); None when there is none."""
    starts = [0, *(m.end() for m in re.finditer(r"\s+", run))]
    for start in starts:
        expression = run[start:].strip()
        python = expression.translate(_TO_PYTHON)
        try:
            value, binary = _value(ast.parse(python, mode="eval").body)
        except (SyntaxError, ValueError, ZeroDivisionError):
            continue
        return (expression, value) if binary else None
    return None


def arithmetic_problems(text: str) -> list[str]:
    """Every `a op b = c` (or `≈ c`) in `text` that does not hold at the precision `c` is
    written to. Anything that is not plain arithmetic on numbers is left alone."""
    text = _THOUSANDS.sub("", text)
    problems = []
    for sign in re.finditer("[=≈]", text):
        left = _LEFT.search(text[: sign.start()])
        right = _RIGHT.match(text, sign.end())
        if left is None or right is None:
            continue
        found = _evaluate(left.group(0))
        if found is None:
            continue
        expression, value = found
        stated = right.group(1).replace(_MINUS, "-")
        decimals = len(stated.split(".")[1]) if "." in stated else 0
        slack = 10.0**-decimals * (1.0 if sign.group(0) == "≈" else 0.5)
        if abs(value - float(stated)) > slack + 1e-9:
            shown = f"{value:.{decimals + 2}f}".rstrip("0").rstrip(".")
            problems.append(f"{expression} {sign.group(0)} {stated} is wrong (it is {shown})")
    return problems


# --- Diagrams -------------------------------------------------------------------------------


def diagram_problems(where: str, diagram: dict[str, Any]) -> list[str]:
    """A diagram block's node ids are unique and every edge joins two of its nodes."""
    ids = [n["id"] for n in diagram.get("nodes", [])]
    problems = [
        f"{where}: node id {i!r} repeats" for i in sorted({i for i in ids if ids.count(i) > 1})
    ]
    known = set(ids)
    dangling = sorted({e[end] for e in diagram.get("edges", []) for end in ("from", "to")} - known)
    if dangling:
        problems.append(f"{where}: edges point at missing nodes {dangling}; use node ids")
    return problems


# --- The check ------------------------------------------------------------------------------


def formula_sources(inputs: dict[str, Any]) -> dict[str, list[str]]:
    """Each formula anchor of the input → its LaTeX (a math block's `meta.latex` or text;
    the prose a distilled formula cites → that formula's LaTeX)."""
    sources: dict[str, list[str]] = {}
    for block in inputs.get("blocks", []):
        if block.get("kind") == "math":
            latex = (block.get("meta") or {}).get("latex") or block.get("text") or ""
            sources.setdefault(block["anchor"], []).append(latex)
    for formula in inputs.get("distilled_formulas", []):
        for anchor in formula.get("cites", []):
            sources.setdefault(anchor, []).append(formula.get("latex", ""))
    return sources


def _offered(inputs: dict[str, Any]) -> set[str]:
    anchors = {b["anchor"] for b in inputs.get("blocks", [])}
    anchors |= {d["anchor"] for d in inputs.get("math_descriptions", [])}
    anchors |= {s.get("first_anchor") for s in inputs.get("notation_table") or []} - {None}
    return anchors | cited_anchors(inputs)


def _formula_problems(formula: dict[str, Any], sources: dict[str, list[str]]) -> list[str]:
    anchor, latex = formula["anchor"], formula["latex"]
    where = f"formulas: {anchor}"
    if anchor not in sources:
        return [f"{where} is not a formula of the input; use a math block of inputs.blocks "
                "or the prose block a distilled_formulas entry cites"]  # fmt: skip
    problems = []
    written = [s for s in sources[anchor] if s.strip()]
    if written and not any(same_formula(latex, s) for s in written):
        problems.append(f"{where} latex does not match the source; copy it: {written[0]!r}")
    explained = set().union(*(symbol_atoms(s["symbol"]) for s in formula["symbols"]))
    missing = sorted(symbol_atoms(latex) - explained)
    if missing:
        problems.append(f"{where} uses {', '.join(missing)} without explaining them; add a "
                        "symbols entry for each")  # fmt: skip
    example = [formula["worked_example"], formula["try_it"]]
    problems += [
        f"{where} {p}" for s in leaf_spans(example) for p in arithmetic_problems(s["text"])
    ]
    problems += diagram_problems(f"{where} diagram", formula["diagram"])
    words = sum(count_words(s["text"]) for s in leaf_spans(formula))
    if words > FORMULA_WORDS_MAX:
        problems.append(f"{where} runs to {words} words; keep a formula under {FORMULA_WORDS_MAX}")
    return problems


def _concept_problems(formulas: Iterable[dict[str, Any]], inputs: dict[str, Any]) -> list[str]:
    canonical = {c["canonical"] for c in inputs.get("existing_concepts", [])}
    return [
        f"explore_further: shelf_concept {p['shelf_concept']!r} is not a canonical in "
        "inputs.existing_concepts; use one of them or null"
        for f in formulas
        for p in f["explore_further"]["prerequisites"]
        if p["shelf_concept"] is not None and p["shelf_concept"] not in canonical
    ]


def check_math_explainer(output: dict[str, Any], selection: Selection) -> list[str]:
    inputs = selection.inputs
    sources = formula_sources(inputs)
    formulas = output["formulas"]
    anchors = [f["anchor"] for f in formulas]
    problems = [f"formulas: {a} is explained twice; merge them" for a in sorted(set(anchors))
                if anchors.count(a) > 1]  # fmt: skip
    for formula in formulas:
        problems += _formula_problems(formula, sources)
    problems += diagram_problems("big_picture: map", output["big_picture"]["map"])
    problems += [
        f"path: {step['title']!r} names {step['formula']}, which is not one of formulas[].anchor"
        for step in output["path"]
        if step["formula"] is not None and step["formula"] not in anchors
    ]
    problems += _concept_problems(formulas, inputs)
    outside = sorted(cited_anchors(output) - _offered(inputs))
    if outside:
        problems.append(f"cites anchors the input does not offer: {outside[:10]}")
    return problems

"""MathML → TeX, so `math` blocks carry `meta.latex` the reader can typeset.

A TeX `<annotation>` or `alttext` wins when the source has one; otherwise the common
presentation elements are translated (scripts, fractions, radicals, fences, accents,
matrices). Anything unknown contributes its children, so the output degrades to plain
text rather than failing.
"""

import re

from app.pipeline.parse.anchors import normalize_text
from app.pipeline.parse.dom import Element, attr, children, local_name, text_of
from app.pipeline.parse.text import tex_symbol

# Accent glyphs below are the point, not look-alike typos.
# ruff: noqa: RUF001

# fmt: off
_FUNCTIONS = frozenset({
    "sin", "cos", "tan", "cot", "sec", "csc", "arcsin", "arccos", "arctan", "sinh", "cosh",
    "tanh", "log", "ln", "lg", "exp", "lim", "liminf", "limsup", "max", "min", "sup", "inf",
    "det", "dim", "ker", "gcd", "deg", "arg", "Pr",
})
_ACCENTS = {
    "¯": r"\overline", "‾": r"\overline", "^": r"\hat", "ˆ": r"\hat", "~": r"\tilde",
    "˜": r"\tilde", "→": r"\vec", "⃗": r"\vec", "˙": r"\dot", "¨": r"\ddot",
    "︷": r"\overbrace", "︸": r"\underbrace", "_": r"\underline",
}
# fmt: on
_COMMAND = re.compile(r"^\\[A-Za-z]+$")
_SKIPPED = frozenset({"annotation", "annotation-xml", "mphantom", "none", "mprescripts"})


def _text(el: Element) -> str:
    return normalize_text(text_of(el))


def _symbols(text: str) -> str:
    return "".join(tex_symbol(c) for c in text).strip()


def _group(tex: str) -> str:
    """Brace a script base or argument unless it is one character or one command."""
    return tex if len(tex) == 1 or _COMMAND.match(tex) else f"{{{tex}}}"


def _row(els: list[Element]) -> str:
    return " ".join(t for t in (_tex(e) for e in els) if t)


def _script(name: str, parts: list[str]) -> str:
    base = parts[0] if parts else ""
    if name == "msub":
        return f"{_group(base)}_{_group(parts[1])}" if len(parts) > 1 else base
    if name == "msup":
        return f"{_group(base)}^{_group(parts[1])}" if len(parts) > 1 else base
    if len(parts) < 3:
        return base
    return f"{_group(base)}_{_group(parts[1])}^{_group(parts[2])}"


def _over_under(el: Element, name: str, parts: list[str]) -> str:
    base = parts[0] if parts else ""
    if len(parts) < 2:
        return base
    if name == "munderover" and len(parts) > 2:
        return f"{_group(base)}_{_group(parts[1])}^{_group(parts[2])}"
    accent = _ACCENTS.get(_text(children(el)[1]))
    if accent:
        return f"{accent}{{{base}}}"
    wrapper = r"\overset" if name == "mover" else r"\underset"
    if base.startswith(("\\sum", "\\prod", "\\int", "\\lim")):
        return f"{base}{'^' if name == 'mover' else '_'}{_group(parts[1])}"
    return f"{wrapper}{{{parts[1]}}}{{{base}}}"


def _delimiter(el: Element, name: str, default: str) -> str:
    value = el.get(name, default).strip()
    return "." if not value else f"\\{value}" if value in "{}" else value


def _fenced(el: Element) -> str:
    separator = (attr(el, "separators") or ",").strip()[:1] or ","
    inner = f"{separator} ".join(_tex(c) for c in children(el))
    return f"\\left{_delimiter(el, 'open', '(')}{inner}\\right{_delimiter(el, 'close', ')')}"


def _table(el: Element) -> str:
    rows = [" & ".join(_tex(cell) for cell in children(row)) for row in children(el)]
    return "\\begin{matrix}" + " \\\\ ".join(rows) + "\\end{matrix}"


def _tex(el: Element) -> str:
    name = local_name(el)
    if name in _SKIPPED:
        return ""
    if name == "semantics":
        first = children(el)[:1]
        return _tex(first[0]) if first else ""
    if name == "mi":
        text = _text(el)
        return f"\\{text} " if text in _FUNCTIONS else _symbols(text)
    if name in ("mn", "ms"):
        return _text(el)
    if name == "mo":
        return _symbols(_text(el))
    if name == "mtext":
        text = _text(el)
        return f"\\text{{{text}}}" if text else ""
    if name == "mspace":
        return r"\,"
    parts = [_tex(c) for c in children(el)]
    if name in ("msub", "msup", "msubsup"):
        return _script(name, parts)
    if name in ("mover", "munder", "munderover"):
        return _over_under(el, name, parts)
    if name == "mfrac" and len(parts) == 2:
        return f"\\frac{{{parts[0]}}}{{{parts[1]}}}"
    if name == "msqrt":
        return f"\\sqrt{{{' '.join(parts)}}}"
    if name == "mroot" and len(parts) == 2:
        return f"\\sqrt[{parts[1]}]{{{parts[0]}}}"
    if name == "mfenced":
        return _fenced(el)
    if name == "mtable":
        return _table(el)
    return _row(children(el))


def mathml_to_tex(math: Element) -> str:
    """TeX for a `<math>` element: its TeX annotation, its `alttext`, or a translation."""
    for el in math.iter():
        tex_annotation = local_name(el) == "annotation" and "tex" in attr(el, "encoding").lower()
        if tex_annotation and (tex := _text(el)):
            return tex
    if alt := attr(math, "alttext").strip():
        return alt
    return normalize_text(_row(children(math)))


def is_display(math: Element) -> bool:
    return attr(math, "display").lower() == "block" or attr(math, "mode").lower() == "display"

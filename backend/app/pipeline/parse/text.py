"""Format-agnostic text heuristics shared by the PDF, HTML and Markdown parsers."""

# Bullets, dashes and math glyphs below are the point, not look-alike typos.
# ruff: noqa: RUF001

import re

# --- line joining -----------------------------------------------------------------------

_HYPHEN_END = re.compile(r"[A-Za-z\u00c0-\u024f][-\u00ad]$")


def join_lines(lines: list[str]) -> str:
    """Join wrapped lines into prose, undoing end-of-line hyphenation.

    `para-` + `graph` becomes `paragraph`; a hyphen before an uppercase word or a digit is
    kept (`Jean-` + `Paul`, `pre-` + `2000`), since those are usually real compounds.
    """
    out = ""
    for raw in lines:
        line = raw.strip()
        if not line:
            continue
        if not out:
            out = line
        elif _HYPHEN_END.search(out) and line[0].islower():
            out = out[:-1] + line
        else:
            out = f"{out} {line}"
    return out.replace("\u00ad", "")


# --- lists --------------------------------------------------------------------------------

_BULLET = re.compile(r"^\s*([\u2022\u25e6\u25aa\u25cf\u2023\u2043\u2219\u00b7*\-\u2013])\s+(\S.*)$")
_NUMBERED = re.compile(r"^\s*(\(?(?:\d{1,3}|[a-z])[.)])\s+(\S.*)$")


def list_marker(line: str) -> tuple[bool, str] | None:
    """`(ordered, item_text)` when the line starts a list item, else None."""
    if m := _BULLET.match(line):
        return False, m.group(2)
    if m := _NUMBERED.match(line):
        return True, m.group(2)
    return None


def list_text(items: list[str], *, ordered: bool) -> str:
    return "\n".join(f"{i}. {item}" if ordered else f"- {item}" for i, item in enumerate(items, 1))


# --- captions, labels, back matter ------------------------------------------------------------

_NUM = r"(\d+(?:[.\-]\d+)*[a-z]?)"
FIGURE_CAPTION = re.compile(rf"^(?:figure|fig\.)\s*{_NUM}\b[.:]?\s*", re.IGNORECASE)
TABLE_CAPTION = re.compile(rf"^table\s*{_NUM}\b[.:]?\s*", re.IGNORECASE)
LISTING_CAPTION = re.compile(rf"^(?:listing|example)\s*{_NUM}\b[.:]?\s*", re.IGNORECASE)

_ASIDE_LABEL = re.compile(
    r"^(?P<label>(?:exercises?|problems?|key\s+(?:points?|takeaways?|ideas?)|warning|caution"
    r"|tip|remember|important|note|sidebar|try\s+it)(?:\s+\d+(?:\.\d+)*)?)"
    r"\s*(?:[:.\u2014\u2013-]\s*|$)",
    re.IGNORECASE,
)


def aside_label(text: str) -> tuple[str, str] | None:
    """`(label, rest)` when the text opens with an aside label like `Key point:`."""
    m = _ASIDE_LABEL.match(text.strip())
    if m is None:
        return None
    return m.group("label"), text.strip()[m.end() :].strip()


_BACK_MATTER = re.compile(
    r"^(?:[\dA-Z]+[.)]?\s+)?(bibliography|references|index|works\s+cited|further\s+reading"
    r"|endnotes|notes|sources|glossary\s+index|subject\s+index|name\s+index)\s*$",
    re.IGNORECASE,
)


def is_back_matter(heading: str) -> bool:
    """Bibliography / index headings: kept in the tree, never distilled (`meta.skip`)."""
    return bool(_BACK_MATTER.match(heading.strip()))


# --- code ---------------------------------------------------------------------------------

_LANG_HINTS: list[tuple[str, re.Pattern[str]]] = [
    ("python", re.compile(r"^\s*(def |class \w+.*:|import \w|from \w+ import|print\()", re.M)),
    ("javascript", re.compile(r"\b(const|let) \w+ =|function\s*\w*\(|=> \{|console\.log")),
    ("java", re.compile(r"\bpublic (static |final )*(class|void|int|String)\b")),
    ("c", re.compile(r"^#include\s*<|\bint main\s*\(", re.M)),
    ("go", re.compile(r"^package \w+|\bfunc \w+\(", re.M)),
    ("rust", re.compile(r"\bfn \w+\(|\blet mut\b")),
    ("sql", re.compile(r"\b(SELECT|INSERT INTO|CREATE TABLE|UPDATE \w+ SET)\b")),
    ("shell", re.compile(r"^\s*(\$ |sudo |#!/bin/(ba)?sh)", re.M)),
    ("html", re.compile(r"^\s*<(!doctype|html|div|p|body)\b", re.I | re.M)),
    ("json", re.compile(r"^\s*[\[{]\s*\"\w+\"\s*:", re.M)),
]


def guess_language(code: str) -> str | None:
    """Cheap keyword guess; `explain-code` can correct it later."""
    for language, pattern in _LANG_HINTS:
        if pattern.search(code):
            return language
    return None


# --- math ---------------------------------------------------------------------------------

_TEX = {
    "α": r"\alpha", "β": r"\beta", "γ": r"\gamma", "δ": r"\delta", "ε": r"\epsilon",
    "θ": r"\theta", "λ": r"\lambda", "μ": r"\mu", "π": r"\pi", "ρ": r"\rho",
    "σ": r"\sigma", "τ": r"\tau", "φ": r"\phi", "ω": r"\omega", "Δ": r"\Delta",
    "Σ": r"\Sigma", "Ω": r"\Omega", "∑": r"\sum", "∏": r"\prod", "∫": r"\int",
    "√": r"\sqrt", "∞": r"\infty", "∂": r"\partial", "∇": r"\nabla", "≤": r"\leq",
    "≥": r"\geq", "≠": r"\neq", "≈": r"\approx", "±": r"\pm", "×": r"\times",
    "÷": r"\div", "·": r"\cdot", "→": r"\to", "∈": r"\in", "−": "-",
}  # fmt: skip
MATH_SYMBOLS = frozenset(_TEX) | frozenset("=^")


def latex_from_text(text: str) -> str | None:
    """LaTeX for a flat formula whose every symbol has a known mapping, else None.

    Only a best effort: fractions, radicals and scripts need `describe-math` (vision).
    """
    parts: list[str] = []
    for char in text.strip():
        if char in _TEX:
            parts.append(f"{_TEX[char]} " if _TEX[char].startswith("\\") else _TEX[char])
        elif char.isascii():
            parts.append(char)
        else:
            return None
    latex = re.sub(r"\s+", " ", "".join(parts)).strip()
    return latex or None


def table_text(header: list[str], rows: list[list[str]]) -> str:
    """Tables as ` | `-joined lines: searchable text for a block kept as structure."""
    return "\n".join(" | ".join(cells) for cells in [header, *rows] if any(cells))

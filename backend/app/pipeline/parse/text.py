"""Format-agnostic text heuristics shared by the PDF, EPUB, HTML and Markdown parsers."""

# Bullets, dashes and math glyphs below are the point, not look-alike typos.
# ruff: noqa: RUF001

import re
from collections.abc import Sequence

from app.pipeline.parse.anchors import normalize_text

# --- line joining -----------------------------------------------------------------------

_HYPHEN_END = re.compile(r"[A-Za-z\u00c0-\u024f][-\u00ad]$")


def join_lines(lines: list[str]) -> str:
    """Join wrapped lines into prose, undoing end-of-line hyphenation.

    `para-` + `graph` becomes `paragraph`; before an uppercase word or a digit the hyphen
    is kept but the break still closes up (`Jean-` + `Paul` → `Jean-Paul`), since those
    are usually real compounds. Soft hyphens always disappear.
    """
    out = ""
    for raw in lines:
        line = raw.strip()
        if not line:
            continue
        if not out:
            out = line
        elif _HYPHEN_END.search(out):
            soft = out.endswith("\u00ad")
            out = out[:-1] + line if soft or line[0].islower() else out + line
        else:
            out = f"{out} {line}"
    return out.replace("\u00ad", "")


# --- lists --------------------------------------------------------------------------------

# Bullet glyphs, incl. Symbol/Wingdings private-use bullets from Word exports; these may
# touch the item text (`\u2022item`). ASCII `*` / `-` and dashes need a following space.
_GLYPHS = (
    "\u2022\u25e6\u25aa\u25ab\u25a0\u25a1\u25cf\u25cb\u25ba\u25b8\u2023\u2043\u2219\u00b7"
    "\u2713\u2714\u27a2\u2756\u2605\uf0b7\uf0a7\uf076\uf0d8\uf0fc\uf0a8"
)
_BULLET = re.compile(rf"^\s*(?:[{_GLYPHS}]\s*|[*\-\u2013\u2014]\s+)(\S.*)$")
_NUMBERED = re.compile(r"^\s*(\(?(?:\d{1,3}|[a-z])[.)])\s+(\S.*)$")


def list_marker(line: str) -> tuple[bool, str] | None:
    """`(ordered, item_text)` when the line starts a list item, else None."""
    if m := _BULLET.match(line):
        return False, m.group(1)
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
    r"\s*(?:[:.\u2014\u2013-](?!\d)\s*|$)",  # `Exercise 5.15 through …` is prose
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


# --- outlines and metadata -------------------------------------------------------------------

PART_RE = re.compile(r"^(?:part|book)\s+(?:[ivxlc]+|\d+|[a-z]+)\b", re.IGNORECASE)
_NUMBERING = re.compile(
    r"^(?:(?:part|chapter|book|section)\s+)?(?:[ivxlc]+|\d+(?:\.\d+)*)[.:)]?\s+", re.IGNORECASE
)
_NON_ALNUM = re.compile(r"[^0-9a-z]+")


def title_key(text: str) -> str:
    """Letters and digits only, casefolded: how a heading line is matched to an outline title."""
    return _NON_ALNUM.sub("", normalize_text(text).casefold())


def title_keys(text: str) -> set[str]:
    """The title with and without its numbering (`Chapter 3`, `3.2`)."""
    return {k for k in (title_key(text), title_key(_NUMBERING.sub("", normalize_text(text)))) if k}


def outline_levels(entries: Sequence[tuple[int, str]]) -> list[int]:
    """Container level (0 part … 3 subsection) of each `(depth, title)` outline entry.

    Depth 1 is a chapter, unless the outline's depth-1 entries include `Part …` ones: then
    those are parts and everything under them moves up one level.
    """
    has_parts = any(depth == 1 and PART_RE.match(title.strip()) for depth, title in entries)
    levels: list[int] = []
    in_part = False
    for depth, title in entries:
        if depth == 1:
            in_part = has_parts and bool(PART_RE.match(title.strip()))
        levels.append(min(depth - 1 if in_part else depth, 3))
    return levels


def split_authors(raw: str) -> list[str]:
    """`A; B and C` → names; a single `Meadows, Donella` is turned around."""
    parts = [p.strip() for p in re.split(r";|&|\band\b", raw) if p.strip()]
    if len(parts) == 1 and parts[0].count(",") == 1:
        last, first = (s.strip() for s in parts[0].split(","))
        if " " not in last and " " not in first:
            return [f"{first} {last}"]  # `Meadows, Donella`
    return [a.strip() for p in parts for a in p.split(",") if a.strip()]


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


def tex_symbol(char: str) -> str:
    """The TeX for one math glyph (`π` → `\\pi `), or the glyph itself."""
    tex = _TEX.get(char, char)
    return f"{tex} " if tex.startswith("\\") else tex


def latex_from_text(text: str) -> str | None:
    """LaTeX for a flat formula whose every symbol has a known mapping, else None.

    Only a best effort: fractions, radicals and scripts need `describe-math` (vision).
    """
    parts: list[str] = []
    for char in text.strip():
        if char in _TEX:
            parts.append(tex_symbol(char))
        elif char.isascii():
            parts.append(char)
        else:
            return None
    latex = re.sub(r"\s+", " ", "".join(parts)).strip()
    return latex or None


def table_text(header: list[str], rows: list[list[str]]) -> str:
    """Tables as ` | `-joined lines: searchable text for a block kept as structure."""
    return "\n".join(" | ".join(cells) for cells in [header, *rows] if any(cells))


_PROSE_GRID_SHARE = 0.5  # at least this share of cells continue a sentence: prose, not data
_CONTINUES = re.compile(r"[a-z,.;:)]")


def is_prose_grid(header: Sequence[object], rows: Sequence[Sequence[object]]) -> bool:
    """A text passage the extractor cut into cells (a framed prompt, a quoted transcript),
    not a data table.

    Its cells read as one run of text: most start mid-word or mid-sentence (`onment`,
    `, a desk`), the header row included, where a real table has labels. Such a grid has
    no columns to compare, so explaining it as a table only restates the garbled text.
    """

    def share(cells: Sequence[object]) -> float:
        texts = [str(c).strip() for c in cells if str(c).strip()]
        return sum(bool(_CONTINUES.match(t)) for t in texts) / len(texts) if texts else 0.0

    everything = [*header, *(c for row in rows for c in row)]
    return share(header) >= _PROSE_GRID_SHARE and share(everything) >= _PROSE_GRID_SHARE

"""In-text citation markers → the anchors citing each bibliography entry (`cited_at`).

    numbered     [3]  [3, 7]  [3–5]  [2, 7-9]            → ordinals 3; 3, 7; 3, 4, 5 …
    author-year  (Vaswani et al., 2017)  (Peters et al., 2017, 2018a; Howard and Ruder, 2018)
                 Vaswani et al. (2017)   Vaswani et al. [2017]   Le and Mikolov (2014)

Numbered markers are read only when the bibliography is numbered (a `[CLS]`-free `[12]` in
an author-year paper is more likely an equation or a vector). An author-year citation
matches an entry by first-author surname (accent- and case-folded, last word, so
`Tjong Kim Sang` and `van den Oord` work) and year; a year suffix (`2018a`) picks among
same-author-same-year entries, a second surname (`X and Y`) or `et al.` narrows further.
Pure: leaves and parsed references in, `{ordinal: [anchor, …]}` out, in reading order.
"""

# Dashes, quotes and footnote marks in the patterns below are the point, not typos.
# ruff: noqa: RUF001, RUF002

import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass

from app.papers.refparse import ParsedReference
from app.papers.refparse import surname as fold

_NUMERIC = re.compile(r"\[(\s*\d{1,4}(?:\s*[,;–—-]\s*\d{1,4})*\s*)\]")
_RANGE = re.compile(r"(\d{1,4})\s*[–—-]\s*(\d{1,4})")
_MAX_RANGE = 50
_YEAR = r"(?:19|20)\d{2}[a-z]?"
_YEARS = rf"{_YEAR}(?:\s*,\s*(?:{_YEAR}|[a-z]\b))*"
_NAME = r"[A-ZÀ-ɏ][\wÀ-ɏ'’¨-]+"
# A surname is at most four capitalised words (`Van Den Oord`): an unbounded run made a
# long title-case leaf quadratic (every word restarts the run).
_SURNAME = rf"{_NAME}(?:\s+{_NAME}){{0,3}}"
_AUTHORS = rf"{_SURNAME}(?:\s+(?:et\s+al\.?|(?:and|&)\s+{_SURNAME}))?"
_PAREN = re.compile(r"\(([^()]{4,400})\)")
_IN_PAREN = re.compile(rf"(?P<authors>{_AUTHORS})\s*,?\s+(?P<years>{_YEARS})")
_NARRATIVE = re.compile(rf"(?P<authors>{_AUTHORS})\s*[\(\[](?P<years>{_YEARS})[\)\]]")
_SPLIT_AUTHORS = re.compile(r"\s+(?:and|&)\s+|\s+et\s+al\.?", re.IGNORECASE)


@dataclass(frozen=True, slots=True)
class Cite:
    first: str  # folded surname of the first author
    second: str | None  # of the second, when the citation names two
    et_al: bool
    year: str  # `2018` or `2018a`


def numeric_ordinals(text: str) -> list[int]:
    """Every ordinal a `[…]` marker in the text names, ranges expanded."""
    found: list[int] = []
    for m in _NUMERIC.finditer(text):
        for part in re.split(r"\s*[,;]\s*", m.group(1).strip()):
            if r := _RANGE.fullmatch(part):
                lo, hi = int(r.group(1)), int(r.group(2))
                found.extend(range(lo, hi + 1) if 0 < hi - lo <= _MAX_RANGE else [lo, hi])
            elif part.isdigit():
                found.append(int(part))
    return found


def _cites(authors: str, years: str) -> list[Cite]:
    names = [n.strip() for n in _SPLIT_AUTHORS.split(authors) if n.strip()]
    if not names:
        return []
    et_al = bool(re.search(r"et\s+al", authors))
    first, second = fold(names[0]), fold(names[1]) if len(names) > 1 else None
    out: list[Cite] = []
    base = ""
    for token in re.split(r"\s*,\s*", years.strip()):
        if re.fullmatch(_YEAR, token):
            base = token[:4]
            out.append(Cite(first, second, et_al, token))
        elif base and re.fullmatch(r"[a-z]", token):  # `2018a, b`
            out.append(Cite(first, second, et_al, base + token))
    return out


def author_year_cites(text: str) -> list[Cite]:
    """Every author-year citation in the text, parenthetical and narrative."""
    found: list[Cite] = []
    for m in _PAREN.finditer(text):
        for segment in m.group(1).split(";"):
            if hit := _IN_PAREN.search(segment):
                found.extend(_cites(hit.group("authors"), hit.group("years")))
    for m in _NARRATIVE.finditer(text):
        found.extend(_cites(m.group("authors"), m.group("years")))
    return found


class _Index:
    """Entries by (first-author surname, year), with natbib's a/b suffixes assigned."""

    def __init__(self, refs: Sequence[ParsedReference]) -> None:
        self.by_key: dict[tuple[str, str], list[ParsedReference]] = {}
        for ref in refs:
            if not ref.authors or ref.year is None:
                continue
            self.by_key.setdefault((fold(ref.authors[0]), str(ref.year)), []).append(ref)

    def match(self, cite: Cite) -> ParsedReference | None:
        pool = self.by_key.get((cite.first, cite.year[:4]), [])
        if len(cite.year) > 4:  # the suffix names one of them
            exact = [r for r in pool if r.year_label == cite.year]
            if exact:
                pool = exact
            else:
                index = ord(cite.year[4]) - ord("a")
                pool = [pool[index]] if 0 <= index < len(pool) else []
        if len(pool) > 1 and cite.second:
            pool = [r for r in pool if len(r.authors) > 1 and fold(r.authors[1]) == cite.second]
        if len(pool) > 1 and cite.et_al:
            pool = [r for r in pool if len(r.authors) > 2] or pool
        return pool[0] if pool else None


def link_citations(
    leaves: Iterable[tuple[str, str]], refs: Sequence[ParsedReference], *, numbered: bool
) -> dict[int, list[str]]:
    """`{ordinal: anchors citing it}` over the body leaves `(anchor, text)`."""
    ordinals = {r.ordinal for r in refs}
    index = _Index(refs)
    cited: dict[int, list[str]] = {}
    for anchor, text in leaves:
        hits: list[int] = []
        if numbered:
            hits = [n for n in numeric_ordinals(text) if n in ordinals]
        else:
            hits = [ref.ordinal for c in author_year_cites(text) if (ref := index.match(c))]
        for ordinal in hits:
            anchors = cited.setdefault(ordinal, [])
            if anchor not in anchors:
                anchors.append(anchor)
    return cited

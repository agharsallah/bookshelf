"""The sentence(s) around an in-text citation: what `classify-citations` reads.

`paper_references.cited_at` names the passages (leaf anchors) that cite an entry, but a
passage is often a paragraph citing ten works; the verdict hangs on the one sentence that
holds the marker. `context(text, ordinal=, first_author=, year=)` finds it:

    split the passage into sentences      (`et al.`, `e.g.`, `Fig.` … never end one)
    keep those whose markers name the entry   numbered `[3]`, `[2, 3–5]`  → ordinal
                                              author-year `(Vaswani et al., 2017)`
                                              → first-author surname and year
    a short hit (< SHORT_SENTENCE chars) takes the sentence before it along
    nothing found (a marker split over a line): the passage's opening, clipped

Pure and deterministic (the selector hashes its output), built on the same marker readers
as `papers.citations`, which produced `cited_at` in the first place.
"""

# Dashes and quotes in the patterns and examples are the point, not typos.
# ruff: noqa: RUF001, RUF002

import re

from app.papers.citations import author_year_cites, numeric_ordinals
from app.papers.refparse import surname

CONTEXT_MAX = 400  # characters of context per citing passage
SHORT_SENTENCE = 60
MAX_SENTENCES = 2  # sentences kept per passage (a paragraph may cite a work twice)

# A full stop after one of these does not end a sentence.
_ABBREVIATIONS = frozenset(
    {"al", "e.g", "i.e", "cf", "fig", "figs", "eq", "eqs", "sec", "no", "vs", "resp", "approx",
     "tab", "ref", "refs", "ch", "vol", "pp", "etc", "et"}
)  # fmt: skip
_BOUNDARY = re.compile(r"(?<=[.!?])\s+(?=[\[(\"“‘A-Z0-9])")
_LAST_WORD = re.compile(r"([A-Za-z.]+)\.$")


def sentences(text: str) -> list[str]:
    """The passage's sentences, whitespace-normalised, abbreviations kept whole."""
    flat = " ".join(text.split())
    out: list[str] = []
    for piece in _BOUNDARY.split(flat):
        word = _LAST_WORD.search(out[-1]) if out else None
        if word is not None and word.group(1).lower().rstrip(".") in _ABBREVIATIONS:
            out[-1] = f"{out[-1]} {piece}"
        elif piece:
            out.append(piece)
    return out


def cites_entry(sentence: str, *, ordinal: int, first_author: str | None, year: int | None) -> bool:
    """The sentence carries a marker naming this entry, in either citation style."""
    if ordinal in numeric_ordinals(sentence):
        return True
    if not first_author or year is None:
        return False
    key = surname(first_author)
    return any(c.first == key and c.year[:4] == str(year) for c in author_year_cites(sentence))


def _clip(text: str, limit: int = CONTEXT_MAX) -> str:
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def context(text: str, *, ordinal: int, first_author: str | None, year: int | None) -> str:
    """The sentence(s) of `text` citing the entry, clipped to CONTEXT_MAX characters."""
    found = sentences(text)
    picked: list[str] = []
    for index, sentence in enumerate(found):
        if not cites_entry(sentence, ordinal=ordinal, first_author=first_author, year=year):
            continue
        if len(sentence) < SHORT_SENTENCE and index > 0 and found[index - 1] not in picked:
            picked.append(found[index - 1])
        picked.append(sentence)
        if len(picked) >= MAX_SENTENCES:
            break
    return _clip(" ".join(picked) if picked else " ".join(text.split()))

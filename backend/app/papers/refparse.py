"""A paper's bibliography, text → one `ParsedReference` per entry (best effort, pure).

Two steps:

1. **Entries** from the reference section's leaves. Leaves marked `meta.reference`
   (`papers.refblocks` regrouped them from PDF lines) are one entry each. Otherwise the
   style decides: numbered (`[12] …`, `12. …`) starts an entry at each next marker, also
   inside a leaf; author-year starts one at a leaf that opens with a name once the
   current entry has its year, so `Alan Akbik, … Vollgraf.` + `2018. Contextual …` join.
2. **Fields** per entry, by pattern:

       ACL / natbib   Authors. 2018a. Title. In Venue, pages 1–9.
       APA            Authors (2018). Title. Venue, 12(3), 1–9.
       numbered       [n] Authors. Title. Venue, …, 2017.

   DOI and arXiv id (`arXiv:1607.06450`, CoRR `abs/1409.0473`) by regex anywhere.
   `raw` always keeps the full entry, so a bad split loses nothing.
"""

# Dashes, quotes and footnote marks in the patterns below are the point, not typos.
# ruff: noqa: RUF001, RUF002

import re
import unicodedata
from dataclasses import dataclass, field

from app.papers.detect import DOI_RE

MAX_RAW = 5000
_MARKER = re.compile(r"^\s*(?:\[(\d{1,4})\]|(\d{1,4})\.(?=\s+[A-ZÀ-ɏ]))\s*")
_INLINE_MARKER = re.compile(r"\s\[(\d{1,4})\]\s")
_YEAR = re.compile(r"\b((?:19|20)\d{2})([a-z])?\b")
_ARXIV = re.compile(
    r"(?:arxiv(?:\.org/(?:abs|pdf))?[:/]\s*|\babs/)(\d{4}\.\d{4,5})(?:v\d+)?", re.IGNORECASE
)
_ACL = re.compile(
    r"^(?P<authors>[^()]+?)\.\s+(?P<year>(?:19|20)\d{2})(?P<suffix>[a-z])?\.\s+(?P<rest>.+)$"
)
_APA = re.compile(
    r"^(?P<authors>[^()]+?)\s*\((?P<year>(?:19|20)\d{2})(?P<suffix>[a-z])?[^)]*\)\.?\s+(?P<rest>.+)$"
)
# A candidate sentence end; `_sentences` rejects those after an initial or abbreviation.
_SENTENCE = re.compile(r"[.?!]\s+(?=\S)")
_ABBREVIATIONS = frozenset({"proc", "conf", "int", "vol", "no", "pp", "ed", "eds", "vs", "st"})
_VENUE_WORD = re.compile(r"(?:arxiv|preprint|corr)\b", re.IGNORECASE)
_VENUE_END = re.compile(
    r"(?:,\s*|\s+)(?:pages?\b|pp\.|vol(?:ume)?\.?\s|no\.\s)|,\s*\d|\babs/|arxiv:|doi:|https?://"
    r"|,?\s*\(?\b(?:19|20)\d{2}[a-z]?\b\)?\.?$",
    re.IGNORECASE,
)
_EDITORS = re.compile(r"^.*?\beditors?,\s*", re.IGNORECASE)
_NAME_START = re.compile(r"^[A-ZÀ-ɏ][\wÀ-ɏ'’.-]*[\s,]")
_INITIALS = re.compile(r"^(?:[A-Z]\.\s*-?)+$")
_ET_AL = re.compile(r"\bet\s+al\.?|\bothers\b", re.IGNORECASE)


@dataclass(frozen=True, slots=True)
class Leaf:
    anchor: str
    text: str
    marked: bool = False  # `meta.reference`: already exactly one entry


@dataclass(slots=True)
class ParsedReference:
    ordinal: int
    raw: str
    anchor: str | None
    title: str | None = None
    authors: list[str] = field(default_factory=list)
    year: int | None = None
    year_label: str | None = None  # `2018a`: how author-year citations name it
    venue: str | None = None
    doi: str | None = None
    arxiv_id: str | None = None

    @property
    def surnames(self) -> list[str]:
        return [surname(a) for a in self.authors]


def entry_marker(text: str) -> int | None:
    """The `[n]` / `n.` an entry opens with, or None."""
    m = _MARKER.match(text)
    return int(m.group(1) or m.group(2)) if m else None


def surname(author: str) -> str:
    """`Jimmy Lei Ba` → `ba`; `van den Oord` → `oord`; `Täckström` and a PDF's broken
    `T¨ackstr¨om` → `tackstrom`: the key citations are matched on."""
    spacing_marks = "".join(c for c in author if unicodedata.category(c) != "Sk")
    ascii_text = unicodedata.normalize("NFKD", spacing_marks).encode("ascii", "ignore").decode()
    words = re.findall(r"[a-z]+", ascii_text.casefold())
    return words[-1] if words else ""


# --- 1. entries -------------------------------------------------------------------------------


def _numbered_style(leaves: list[Leaf]) -> bool:
    marked = sum(1 for leaf in leaves if entry_marker(leaf.text) is not None)
    return bool(leaves) and marked * 2 >= len(leaves)


def _split_inline(text: str, first: int) -> list[str]:
    """`[3] A … [4] B …` in one leaf → two entries, following the numbering."""
    parts: list[str] = []
    expected, start = first + 1, 0
    for m in _INLINE_MARKER.finditer(text):
        if int(m.group(1)) == expected:
            parts.append(text[start : m.start()].strip())
            start, expected = m.start() + 1, expected + 1
    parts.append(text[start:].strip())
    return [p for p in parts if p]


def _starts_author_year(leaf: str, current: str) -> bool:
    if not _YEAR.search(current) or not _NAME_START.match(leaf):
        return False
    head = leaf[:150]
    return "," in head or " and " in head or bool(_YEAR.search(head))


def split_entries(leaves: list[Leaf]) -> list[tuple[str, str]]:
    """`(anchor, raw)` per bibliography entry; the anchor is the entry's first leaf."""
    if leaves and all(leaf.marked for leaf in leaves):
        return [(leaf.anchor, leaf.text.strip()) for leaf in leaves if leaf.text.strip()]
    numbered = _numbered_style(leaves)
    entries: list[list[str]] = []  # [anchor, text]
    for leaf in leaves:
        text = leaf.text.strip()
        if not text:
            continue
        if numbered:
            marker = entry_marker(text)
            if marker is not None or not entries:
                pieces = _split_inline(text, marker) if marker is not None else [text]
                entries.extend([leaf.anchor, piece] for piece in pieces)
            else:
                entries[-1][1] = f"{entries[-1][1]} {text}"
        elif leaf.marked or not entries or _starts_author_year(text, entries[-1][1]):
            entries.append([leaf.anchor, text])
        else:
            entries[-1][1] = f"{entries[-1][1]} {text}"
    return [(anchor, text) for anchor, text in entries]


# --- 2. fields --------------------------------------------------------------------------------


def _sentences(text: str) -> list[str]:
    """Split at `. ` / `? ` / `! ` unless the word before is an initial (`E.`), an
    abbreviation (`Proc.`) or `al.` inside a name list, or the next word is lowercase
    (`Proc. of`). A `?` or `!` stays with its sentence; a final `.` does not."""
    parts: list[str] = []
    start = 0
    for m in _SENTENCE.finditer(text):
        word = text[start : m.start()].rsplit(" ", 1)[-1]
        nxt = text[m.end() : m.end() + 1]
        if (len(word) == 1 and word.isupper()) or word.casefold() in _ABBREVIATIONS:
            continue
        if nxt.islower() and not _VENUE_WORD.match(text, m.end()):
            continue
        keep = text[m.start()] in "?!"
        parts.append(text[start : m.start() + (1 if keep else 0)].strip())
        start = m.end()
    parts.append(text[start:].strip().rstrip("."))
    return [p for p in parts if p]


def split_authors(text: str) -> list[str]:
    """`A, B, and C` / `A & B` / `Vaswani, A., Shazeer, N.` → names (at most 100)."""
    text = _ET_AL.sub("", text).strip(" ,.;")
    text = re.sub(r",?\s+(?:and|&)\s+", ", ", text)
    tokens = [t.strip(" .;") for t in text.split(",")]
    tokens = [t for t in tokens if t]
    if len(tokens) >= 2 and all(
        _INITIALS.match(t + ".") or _INITIALS.match(t) for t in tokens[1::2]
    ):
        names = [f"{tokens[i + 1].strip()}. {tokens[i]}".replace("..", ".")
                 for i in range(0, len(tokens) - 1, 2)]  # fmt: skip
        if len(tokens) % 2:
            names.append(tokens[-1])
        tokens = names
    return [t for t in tokens if re.search(r"[^\W\d_]", t) and len(t.split()) <= 6][:100]


def _venue(rest: str) -> str | None:
    text = _EDITORS.sub("", re.sub(r"^in\s+", "", rest.strip(), flags=re.IGNORECASE))
    if re.match(r"^(?:arxiv\s+preprint|preprint)", text, re.IGNORECASE):
        return "arXiv"
    cut = _VENUE_END.search(text)
    venue = (text[: cut.start()] if cut and cut.start() > 0 else text).strip(" ,.;")
    return venue[:500] if len(venue) >= 2 else None


def _clean_title(title: str) -> str | None:
    title = re.sub(r",\s*(?:19|20)\d{2}[a-z]?$", "", title.strip())
    title = title.strip(' .,“”"')
    return title[:1000] if len(title) >= 3 else None


def _year(text: str) -> tuple[int | None, str | None]:
    found = _YEAR.findall(text)
    if not found:
        return None, None
    year, suffix = found[-1]
    return int(year), f"{year}{suffix}"


def parse_entry(raw: str, ordinal: int, anchor: str | None) -> ParsedReference:
    """Fields of one entry (module docstring); anything not found stays None."""
    body = _MARKER.sub("", raw, count=1).strip()
    ref = ParsedReference(ordinal=ordinal, raw=raw[:MAX_RAW], anchor=anchor)
    if doi := DOI_RE.search(body):
        ref.doi = doi.group(1).lower()[:300]
    if arxiv := _ARXIV.search(body):
        ref.arxiv_id = arxiv.group(1)
    m = _ACL.match(body) or _APA.match(body)
    if m is not None:
        ref.authors = split_authors(m.group("authors"))
        ref.year = int(m.group("year"))
        ref.year_label = f"{m.group('year')}{m.group('suffix') or ''}"
        rest = _sentences(m.group("rest"))
        ref.title = _clean_title(rest[0]) if rest else None
        ref.venue = _venue(" ".join(rest[1:])) if len(rest) > 1 else None
        return ref
    parts = _sentences(body)
    if parts:
        ref.authors = split_authors(parts[0])
    if len(parts) > 1:
        ref.title = _clean_title(parts[1])
        ref.venue = _venue(" ".join(parts[2:])) if len(parts) > 2 else None
    ref.year, ref.year_label = _year(" ".join(parts[1:]) or body)
    return ref


def parse_references(leaves: list[Leaf]) -> list[ParsedReference]:
    """Every entry, numbered by its `[n]` marker when all have one, else by position."""
    entries = split_entries(leaves)
    markers = [entry_marker(raw) for _, raw in entries]
    numbered = bool(entries) and all(m is not None for m in markers)
    unique = numbered and len(set(markers)) == len(markers)
    return [
        parse_entry(raw, marker if unique and marker is not None else i, anchor)
        for i, ((anchor, raw), marker) in enumerate(zip(entries, markers, strict=True), 1)
    ]

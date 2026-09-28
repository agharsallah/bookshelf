"""Is this document a scientific paper? A deterministic guess from its parsed shape.

    signals (page count, short heading-like lines, page-one text)
      → points: abstract · references · introduction · numbered sections · arXiv/DOI · e-mail
      → paper  when ≤ 60 pages, a References heading, and an Abstract (or arXiv/DOI plus an
               Introduction), docs/PAPERS.md §3

The guess only applies when a person has not chosen the genre (`documents.meta.genre_source
!= "human"`, see `services.documents.GENRE_SOURCE`); `paper_mode` reads that. Signals come
either from PDF blocks (`papers.outline`, during parsing) or from any parsed tree
(`tree_signals`, for EPUB / HTML / Markdown and outline overrides).
"""

# Dashes, quotes and footnote marks in the patterns below are the point, not typos.
# ruff: noqa: RUF001

import re
from collections.abc import Iterable
from dataclasses import dataclass, field
from enum import StrEnum

from app.models import Document
from app.models.enums import DocumentKind, Genre
from app.pipeline.parse.model import ParsedDocument
from app.pipeline.parse.text import title_key

MAX_PAGES = 60
GENRE_DETECTED = "detected"  # `documents.meta.genre_source` after a detection
_HEADING_MAX_CHARS = 80

_NUMBERED = re.compile(r"^\d{1,2}\.?\s+[A-Z][^.]{2,60}$")
# `arXiv:1706.03762v7`, `10.1145/3292500.3330701`
ARXIV_RE = re.compile(r"\barxiv:\s*(\d{4}\.\d{4,5}(?:v\d+)?)", re.IGNORECASE)
DOI_RE = re.compile(r"\b(10\.\d{4,9}/[^\s\"<>]+[^\s\"<>.,;)\]])")
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+|\{[\w,. ]+\}@[\w.-]+")
_ABSTRACT_RUN_IN = re.compile(r"^abstract\s*[—–:.-]", re.IGNORECASE)

ABSTRACT_KEYS = frozenset({"abstract"})
REFERENCE_KEYS = frozenset({"references", "bibliography", "referencesandnotes", "literaturecited"})


class PaperMode(StrEnum):
    """Whether the parser should treat the document as a paper."""

    FORCE = "force"  # a person said it is a paper
    NEVER = "never"  # a person said it is something else
    AUTO = "auto"  # detect


@dataclass(frozen=True, slots=True)
class Signals:
    page_count: int | None
    headings: tuple[str, ...]  # heading texts and short stand-alone lines, in order
    first_page: str  # text of page one


@dataclass(frozen=True, slots=True)
class Guess:
    genre: Genre | None  # Genre.PAPER, or None: no opinion (keep the default)
    score: int
    reasons: tuple[str, ...] = field(default_factory=tuple)

    @property
    def is_paper(self) -> bool:
        return self.genre is Genre.PAPER


def paper_mode(document: Document) -> PaperMode:
    """FORCE / NEVER when a person chose the genre, AUTO otherwise."""
    from app.services.documents import GENRE_SOURCE  # lazy: services.documents has an import cycle

    if document.meta.get(GENRE_SOURCE) == "human":
        return PaperMode.FORCE if document.genre is Genre.PAPER else PaperMode.NEVER
    return PaperMode.AUTO


def _has(headings: Iterable[str], keys: frozenset[str]) -> bool:
    return any(_key(h) in keys for h in headings)


def _key(heading: str) -> str:
    """`2 References` / `REFERENCES` / `References:` → `references`."""
    return title_key(re.sub(r"^(?:\d+|[IVX]+)\.?\s+", "", heading.strip()))


def guess_genre(signals: Signals) -> Guess:
    """PAPER when the signals add up (module docstring), else no opinion."""
    heads = signals.headings
    abstract = _has(heads, ABSTRACT_KEYS) or any(_ABSTRACT_RUN_IN.match(h) for h in heads)
    references = _has(heads, REFERENCE_KEYS)
    introduction = any(_key(h) == "introduction" for h in heads)
    identifier = bool(ARXIV_RE.search(signals.first_page) or DOI_RE.search(signals.first_page))
    found = [
        (abstract, "abstract", 2),
        (references, "references", 2),
        (introduction, "introduction", 1),
        (sum(1 for h in heads if _NUMBERED.match(h.strip())) >= 3, "numbered sections", 1),
        (identifier, "arXiv id or DOI on page one", 1),
        (bool(_EMAIL.search(signals.first_page)), "author e-mail on page one", 1),
    ]
    reasons = [name for flag, name, _ in found if flag]
    score = sum(points for flag, _, points in found if flag)
    short = signals.page_count is None or signals.page_count <= MAX_PAGES
    paper = short and references and (abstract or (identifier and introduction))
    return Guess(Genre.PAPER if paper else None, score, tuple(reasons))


def tree_signals(parsed: ParsedDocument) -> Signals:
    """Signals from any parsed tree: container headings plus short leaf lines."""
    headings: list[str] = []
    first: list[str] = []
    for node in parsed.walk():
        text = node.heading if node.kind.is_container else node.text
        if not text:
            continue
        if node.kind.is_container or len(text) <= _HEADING_MAX_CHARS:
            headings.append(text)
        if node.page_from == 1 and not node.kind.is_container:
            first.append(text)
    return Signals(parsed.page_count, tuple(headings), "\n".join(first))


def apply_guess(document: Document, parsed: ParsedDocument, *, from_tree: bool) -> None:
    """Set `document.genre` from the parse (AUTO mode only; a person's choice stands).

    `parsed.genre` is the PDF outline strategy's verdict; `from_tree` also lets the tree's
    signals decide when no strategy judged (other formats, an outline override). A document
    that no longer reads as a paper drops a genre that was only ever detected.
    """
    from app.services.documents import GENRE_SOURCE  # lazy: services.documents import cycle

    if paper_mode(document) is not PaperMode.AUTO:
        return
    paper = parsed.genre == Genre.PAPER or (
        parsed.genre is None and from_tree and guess_genre(tree_signals(parsed)).is_paper
    )
    if paper:
        document.genre = Genre.PAPER
        document.meta = {**document.meta, GENRE_SOURCE: GENRE_DETECTED}
    elif document.meta.get(GENRE_SOURCE) == GENRE_DETECTED:
        document.genre = Genre.ARTICLE if document.kind is DocumentKind.ARTICLE else Genre.BOOK
        document.meta = {k: v for k, v in document.meta.items() if k != GENRE_SOURCE}

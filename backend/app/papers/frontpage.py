"""What page one says about a paper: authors, DOI, arXiv id, year (best effort, pure).

Page one is read as plain text, one line per text line (`page_text` for PDFs includes the
rotated arXiv stamp in the margin, which the parser drops as furniture):

    identifiers  arXiv:1706.03762v7 → 1706.03762;  10.1145/… → the DOI
    year         a venue line (`31st Conference on … (NIPS 2017)`), else the arXiv id's
                 YYMM, else a copyright year
    authors      person-like lines between the title and the Abstract; lines with an
                 e-mail, digits or an affiliation word are skipped
"""

# Dashes, quotes and footnote marks in the patterns below are the point, not typos.
# ruff: noqa: RUF001

import re
from dataclasses import dataclass, field
from pathlib import Path

from app.papers.detect import ARXIV_RE, DOI_RE
from app.papers.sections import ABSTRACT, key

_VENUE_YEAR = re.compile(
    r"(?:conference|proceedings|workshop|symposium|journal|transactions|nips|neurips|icml|iclr"
    r"|acl|naacl|emnlp|eacl|coling|cvpr|iccv|eccv|aaai|ijcai|kdd|sigir|www)\b[^\n]{0,80}?"
    r"\b((?:19|20)\d{2})\b",
    re.IGNORECASE,
)
_COPYRIGHT = re.compile(r"(?:©|\(c\)|copyright)\s*((?:19|20)\d{2})", re.IGNORECASE)
_MARKS = re.compile(r"[∗*†‡§¶#\d,]+$|^[∗*†‡§¶#]+")
_AFFILIATION = re.compile(
    r"\b(?:universit\w*|institut\w*|college|school|department|dept|laborator\w*|lab|labs"
    r"|research|inc|corp\w*|center|centre|faculty|academy|google|microsoft|meta|facebook"
    r"|openai|deepmind|brain|language|ai|company|ltd|gmbh|usa|china|uk)\b",
    re.IGNORECASE,
)
_PARTICLES = frozenset({"van", "von", "de", "der", "den", "da", "dos", "di", "la", "le", "du"})
_SPLIT = re.compile(r"\s*(?:,|;|\band\b|&|·)\s*")
_MAX_AUTHORS = 100


@dataclass(frozen=True, slots=True)
class FrontPage:
    authors: list[str] = field(default_factory=list)
    doi: str | None = None
    arxiv_id: str | None = None
    year: int | None = None


def page_text(path: Path) -> str:
    """Plain text of a PDF's first page ('' for anything else or an unreadable file)."""
    if path.suffix.lower() != ".pdf" or not path.is_file():
        return ""
    from app.pipeline.parse.pdf import mupdf  # lazy: only PDFs need PyMuPDF here

    try:
        with mupdf.open_pdf(path) as doc:
            return mupdf.plain_text(mupdf.pages(doc)[0]) if doc.page_count else ""
    except RuntimeError:
        return ""


def _year(text: str, arxiv_id: str | None) -> int | None:
    if m := _VENUE_YEAR.search(text):
        return int(m.group(1))
    if arxiv_id and re.match(r"^\d{4}\.", arxiv_id):
        return 2000 + int(arxiv_id[:2])
    if m := _COPYRIGHT.search(text):
        return int(m.group(1))
    return None


def _person(name: str) -> bool:
    words = name.split()
    if not 2 <= len(words) <= 5 or len(name) > 60:
        return False
    return all(w[:1].isupper() or w.lower() in _PARTICLES for w in words)


def _author_names(line: str) -> list[str]:
    """The person names on one line, or [] when the line is not an author line."""
    text = _MARKS.sub("", line.strip()).strip()
    if not text or "@" in text or _AFFILIATION.search(text) or re.search(r"\d", text):
        return []
    names = [_MARKS.sub("", n).strip() for n in _SPLIT.split(text)]
    names = [n for n in names if n]
    return names if names and all(_person(n) for n in names) else []


def _after_title(lines: list[str], title: str | None) -> list[str]:
    """The lines after the title (after the first line when the title is not found)."""
    wanted = key(title or "")
    for i in range(len(lines) if wanted else 0):
        joined = ""
        for j in range(i, min(i + 4, len(lines))):
            joined += key(lines[j])
            if not joined or not wanted.startswith(joined):
                break
            if len(joined) >= len(wanted):
                return lines[j + 1 :]
    return lines[1:]


def authors_from(text: str, title: str | None) -> list[str]:
    """Author names between the title and the Abstract."""
    names: list[str] = []
    for line in _after_title([ln for ln in text.splitlines() if ln.strip()], title):
        if key(line).startswith(ABSTRACT):
            break
        for name in _author_names(line):
            if name not in names:
                names.append(name)
    return names[:_MAX_AUTHORS]


def read_front_page(text: str, *, title: str | None) -> FrontPage:
    """Identifiers, year and authors from page one's text."""
    arxiv = ARXIV_RE.search(text)
    arxiv_id = re.sub(r"v\d+$", "", arxiv.group(1)) if arxiv else None
    doi = DOI_RE.search(text)
    return FrontPage(
        authors=authors_from(text, title),
        doi=doi.group(1).lower()[:300] if doi else None,
        arxiv_id=arxiv_id,
        year=_year(text, arxiv_id),
    )

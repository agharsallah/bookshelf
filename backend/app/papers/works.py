"""OpenAlex work records → a small frozen `Work` (docs/PAPERS.md §5, P7).

Pure: no HTTP here, only the mapping from one OpenAlex work JSON object (the shape
`GET https://api.openalex.org/works/W…` returns) to the fields Papers uses, plus the id
normalizers the client and the candidate builder share.

    {"id": "https://openalex.org/W2626778328", "doi": "https://doi.org/…",
     "display_name": …, "authorships": [{"author": {"display_name": …}}],
     "publication_year": 2017, "publication_date": "2017-06-12",
     "primary_location": {"source": {"display_name": …}, "pdf_url": …},
     "best_oa_location": {"pdf_url": …}, "locations": [{"landing_page_url":
     "http://arxiv.org/abs/1706.03762", …}], "abstract_inverted_index": {"The": [0, 18]},
     "cited_by_count": …, "topics": [{"display_name": …}],
     "referenced_works": ["https://openalex.org/W…"], "related_works": [...]}

OpenAlex has no arXiv id in `ids`; it is recovered from an arXiv location
(`arxiv.org/abs|pdf/<id>`) or an arXiv DOI (`10.48550/arxiv.<id>`), version suffix dropped.
"""

import re
import unicodedata
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date
from difflib import SequenceMatcher
from typing import Any

# Top-level fields the client asks for (`select=`), so responses stay small.
WORK_FIELDS = (
    "id",
    "doi",
    "display_name",
    "authorships",
    "publication_year",
    "publication_date",
    "primary_location",
    "best_oa_location",
    "locations",
    "abstract_inverted_index",
    "cited_by_count",
    "topics",
    "concepts",
    "referenced_works",
    "related_works",
)

_OPENALEX_ID = re.compile(r"^(?:https?://openalex\.org/)?(W\d+)$", re.IGNORECASE)
_DOI_PREFIX = re.compile(r"^(?:https?://(?:dx\.)?doi\.org/|doi:)", re.IGNORECASE)
# New-style `2101.00001` and old-style `hep-th/9901001` (optionally `math.AG/…`).
_ARXIV_ID = r"(\d{4}\.\d{4,5}|[a-z\-]+(?:\.[A-Z]{2})?/\d{7})(?:v\d+)?"
ARXIV_ID_RE = re.compile(rf"^{_ARXIV_ID}$")
_ARXIV_URL = re.compile(rf"arxiv\.org/(?:abs|pdf)/{_ARXIV_ID}", re.IGNORECASE)
_ARXIV_DOI = re.compile(rf"^10\.48550/arxiv\.{_ARXIV_ID}$", re.IGNORECASE)
TITLE_MATCH = 0.9  # title similarity that counts as "the same paper"
# Concepts are the older taxonomy; used for `fields` only when a work has no topics.
_MIN_CONCEPT_SCORE = 0.3
# The length checks on paper_meta / reading_candidates (supabase/migrations/*_papers.sql):
# OpenAlex occasionally serves longer values, which would fail the whole rebuild.
MAX_TITLE, MAX_VENUE, MAX_ABSTRACT, MAX_DOI, MAX_URL = 1000, 500, 20000, 300, 2048


@dataclass(frozen=True, slots=True)
class Work:
    openalex_id: str  # short form, `W2626778328`
    title: str
    doi: str | None = None  # bare and lower-case, `10.1000/xyz`
    arxiv_id: str | None = None  # without version, `1706.03762`
    authors: tuple[str, ...] = ()
    year: int | None = None
    publication_date: date | None = None
    venue: str | None = None
    abstract: str | None = None
    cited_by_count: int = 0
    pdf_url: str | None = None  # best open-access PDF; arXiv when that is all there is
    fields: tuple[str, ...] = ()  # OpenAlex topics (or concepts), best first
    referenced_works: tuple[str, ...] = ()  # short OpenAlex ids
    related_works: tuple[str, ...] = ()


def short_openalex_id(value: str) -> str:
    """`https://openalex.org/W1` or `w1` → `W1`; anything else is a `ValueError`."""
    match = _OPENALEX_ID.match(value.strip())
    if match is None:
        raise ValueError(f"Not an OpenAlex work id: {value!r}")
    return match.group(1).upper()


def normalize_doi(value: str) -> str:
    """`https://doi.org/10.1/ABC` or `doi:10.1/ABC` → `10.1/abc` (DOIs are case-insensitive)."""
    doi = _DOI_PREFIX.sub("", value.strip()).lower()
    if not doi.startswith("10."):
        raise ValueError(f"Not a DOI: {value!r}")
    return doi


def normalize_arxiv_id(value: str) -> str:
    """`arXiv:1706.03762v5` or an arxiv.org URL → `1706.03762`."""
    raw = value.strip()
    url = _ARXIV_URL.search(raw)
    if url is not None:
        return url.group(1)
    raw = re.sub(r"^arxiv:", "", raw, flags=re.IGNORECASE)
    match = ARXIV_ID_RE.match(raw)
    if match is None:
        raise ValueError(f"Not an arXiv id: {value!r}")
    return match.group(1)


def title_key(title: str) -> str:
    """Lower-case ASCII words only: the form titles are compared in."""
    ascii_text = unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", " ", ascii_text.lower()).strip()


def title_similarity(a: str, b: str) -> float:
    """0-1 similarity of two titles after `title_key` (difflib ratio)."""
    return SequenceMatcher(None, title_key(a), title_key(b)).ratio()


def titles_match(a: str, b: str, threshold: float = TITLE_MATCH) -> bool:
    return bool(title_key(a)) and title_similarity(a, b) >= threshold


def arxiv_pdf_url(arxiv_id: str) -> str:
    return f"https://arxiv.org/pdf/{normalize_arxiv_id(arxiv_id)}"


def reconstruct_abstract(inverted: dict[str, list[int]] | None) -> str | None:
    """Rebuild the abstract text from OpenAlex's `abstract_inverted_index` (word → positions)."""
    if not inverted:
        return None
    positioned = sorted(
        (position, word) for word, positions in inverted.items() for position in positions
    )
    text = " ".join(word for _, word in positioned).strip()
    return text or None


def parse_work(data: dict[str, Any]) -> Work:
    """Map one OpenAlex work object to a `Work`; tolerant of missing and null fields."""
    locations = [loc for loc in data.get("locations") or [] if isinstance(loc, dict)]
    doi = _fits(_optional(normalize_doi, data.get("doi")), MAX_DOI)
    arxiv_id = _arxiv_from(doi, locations)
    return Work(
        openalex_id=short_openalex_id(str(data["id"])),
        title=_clip((data.get("display_name") or data.get("title") or "").strip(), MAX_TITLE)
        or "(untitled)",
        doi=doi,
        arxiv_id=arxiv_id,
        authors=tuple(
            name
            for authorship in data.get("authorships") or []
            if (name := ((authorship or {}).get("author") or {}).get("display_name"))
        ),
        year=data.get("publication_year"),
        publication_date=_optional(date.fromisoformat, data.get("publication_date")),
        venue=_clip(_venue(data.get("primary_location"), locations), MAX_VENUE),
        abstract=_clip(reconstruct_abstract(data.get("abstract_inverted_index")), MAX_ABSTRACT),
        cited_by_count=int(data.get("cited_by_count") or 0),
        pdf_url=_fits(_pdf_url(data.get("best_oa_location"), locations, arxiv_id), MAX_URL),
        fields=_fields(data),
        referenced_works=_ids(data.get("referenced_works")),
        related_works=_ids(data.get("related_works")),
    )


def _clip(text: str | None, limit: int) -> str | None:
    """Prose cut to the column's length check (an "abstract" is sometimes the full text)."""
    return (text[:limit].rstrip() or None) if text else None


def _fits(value: str | None, limit: int) -> str | None:
    """An identifier or URL kept whole or not at all: a truncated one would be wrong."""
    return value if value and len(value) <= limit else None


def _optional[T](parse: Callable[[str], T], value: object) -> T | None:
    """`parse(value)` for a non-empty string, else None (also None when it does not parse)."""
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        return parse(value)
    except ValueError:
        return None


def _arxiv_from(doi: str | None, locations: list[dict[str, Any]]) -> str | None:
    if doi is not None and (match := _ARXIV_DOI.match(doi)):
        return match.group(1)
    for location in locations:
        for key in ("landing_page_url", "pdf_url"):
            url = location.get(key)
            if isinstance(url, str) and (match := _ARXIV_URL.search(url)):
                return match.group(1)
    return None


def _source_name(location: object) -> str | None:
    if not isinstance(location, dict):
        return None
    name = (location.get("source") or {}).get("display_name")
    return name.strip() if isinstance(name, str) and name.strip() else None


def _venue(primary: object, locations: list[dict[str, Any]]) -> str | None:
    """The primary location's source, else the first named source that is not a repository."""
    if name := _source_name(primary):
        return name
    names = [n for loc in locations if (n := _source_name(loc))]
    journals = [n for n in names if "arxiv" not in n.lower()]
    return next(iter(journals or names), None)


def _pdf_url(best_oa: object, locations: list[dict[str, Any]], arxiv_id: str | None) -> str | None:
    for location in [best_oa, *locations]:
        url = location.get("pdf_url") if isinstance(location, dict) else None
        if isinstance(url, str) and url.strip():
            return url.strip()
    return arxiv_pdf_url(arxiv_id) if arxiv_id else None


def _fields(data: dict[str, Any]) -> tuple[str, ...]:
    names = [t.get("display_name") for t in data.get("topics") or [] if isinstance(t, dict)]
    if not names:
        names = [
            c.get("display_name")
            for c in data.get("concepts") or []
            if isinstance(c, dict) and (c.get("score") or 0) >= _MIN_CONCEPT_SCORE
        ]
    return tuple(dict.fromkeys(n for n in names if isinstance(n, str) and n))


def _ids(values: object) -> tuple[str, ...]:
    if not isinstance(values, list):
        return ()
    found = (
        m.group(1).upper() for v in values if isinstance(v, str) and (m := _OPENALEX_ID.match(v))
    )
    return tuple(dict.fromkeys(found))

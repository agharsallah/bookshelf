"""Optional GROBID adapter (P9): header metadata and references from a GROBID service.

Used by `paper_structure` only when `BOOKSHELF_GROBID_URL` is set; otherwise the PyMuPDF
heuristics (`frontpage`, `refparse`) do the work. GROBID answers TEI XML:

    POST {url}/api/processHeaderDocument  input=<pdf>  → teiHeader: title, authors, DOI,
                                                         arXiv id, date, abstract
    POST {url}/api/processReferences      input=<pdf>  → listBibl/biblStruct per entry

The client is injected (`httpx.Client`, a `MockTransport` in tests). The URL is operator
configuration, usually localhost, so it is not sent through the SSRF-guarded fetch client.
"""

import re
from dataclasses import dataclass, field

import httpx
from lxml import etree

from app.core.config import Settings
from app.papers.refparse import MAX_RAW, ParsedReference
from app.services.errors import UpstreamError

TIMEOUT_SECONDS = 120.0
_NS = {"tei": "http://www.tei-c.org/ns/1.0"}
_PARSER = etree.XMLParser(resolve_entities=False, no_network=True, huge_tree=False)
_ARXIV = re.compile(r"(\d{4}\.\d{4,5})")


class GrobidError(UpstreamError):
    """GROBID was unreachable or answered something other than TEI."""


@dataclass(frozen=True, slots=True)
class GrobidHeader:
    title: str | None = None
    authors: list[str] = field(default_factory=list)
    doi: str | None = None
    arxiv_id: str | None = None
    year: int | None = None
    abstract: str | None = None


def _text(node: etree._Element | None) -> str | None:
    if node is None:
        return None
    text = re.sub(r"\s+", " ", "".join(str(t) for t in node.itertext())).strip()
    return text or None


def _first(root: etree._Element, path: str) -> etree._Element | None:
    found = root.find(path, _NS)
    return found


def _authors(scope: etree._Element) -> list[str]:
    names: list[str] = []
    for pers in scope.findall(".//tei:author/tei:persName", _NS):
        parts = [_text(p) for p in pers.findall("tei:forename", _NS)]
        parts.append(_text(pers.find("tei:surname", _NS)))
        name = " ".join(p for p in parts if p)
        if name and name not in names:
            names.append(name)
    return names[:100]


def _year(scope: etree._Element) -> int | None:
    for date in scope.findall(".//tei:date", _NS):
        when = date.get("when") or _text(date) or ""
        if m := re.search(r"\b((?:19|20)\d{2})\b", when):
            return int(m.group(1))
    return None


def _idno(scope: etree._Element, kind: str) -> str | None:
    for idno in scope.findall(".//tei:idno", _NS):
        if (idno.get("type") or "").lower() == kind.lower() and (value := _text(idno)):
            return value
    return None


def _arxiv(scope: etree._Element) -> str | None:
    raw = _idno(scope, "arXiv")
    m = _ARXIV.search(raw or "")
    return m.group(1) if m else None


def _root(xml: bytes) -> etree._Element:
    try:
        return etree.fromstring(xml, parser=_PARSER)
    except etree.XMLSyntaxError as exc:
        raise GrobidError(f"GROBID answered invalid TEI: {exc}") from exc


def parse_header(xml: bytes) -> GrobidHeader:
    """The paper's own metadata from a `processHeaderDocument` TEI."""
    root = _root(xml)
    bibl = _first(root, ".//tei:sourceDesc/tei:biblStruct")
    scope = bibl if bibl is not None else root
    doi = _idno(scope, "DOI")
    return GrobidHeader(
        title=_text(_first(root, ".//tei:titleStmt/tei:title")),
        authors=_authors(scope),
        doi=doi.lower()[:300] if doi else None,
        arxiv_id=_arxiv(scope),
        year=_year(scope),
        abstract=(_text(_first(root, ".//tei:profileDesc/tei:abstract")) or "")[:20000] or None,
    )


def _reference(bibl: etree._Element, ordinal: int) -> ParsedReference | None:
    title = _text(bibl.find("tei:analytic/tei:title", _NS)) or _text(
        bibl.find("tei:monogr/tei:title", _NS)
    )
    venue = _text(bibl.find("tei:monogr/tei:title", _NS)) if title else None
    if venue == title:
        venue = None
    raw = _text(bibl.find(".//tei:note[@type='raw_reference']", _NS))
    authors = _authors(bibl)
    year = _year(bibl)
    raw = raw or ". ".join(p for p in (", ".join(authors), title, venue, str(year or "")) if p)
    if not raw:
        return None
    doi = _idno(bibl, "DOI")
    return ParsedReference(
        ordinal=ordinal,
        raw=raw[:MAX_RAW],
        anchor=None,
        title=title[:1000] if title else None,
        authors=authors,
        year=year,
        year_label=str(year) if year else None,
        venue=venue[:500] if venue else None,
        doi=doi.lower()[:300] if doi else None,
        arxiv_id=_arxiv(bibl),
    )


def parse_references(xml: bytes) -> list[ParsedReference]:
    """One `ParsedReference` per `biblStruct` of a `processReferences` TEI, numbered 1…n."""
    root = _root(xml)
    refs: list[ParsedReference] = []
    for bibl in root.findall(".//tei:listBibl/tei:biblStruct", _NS):
        if (ref := _reference(bibl, len(refs) + 1)) is not None:
            refs.append(ref)
    return refs


class Grobid:
    """A GROBID service at `base_url`, over an injected client."""

    def __init__(self, client: httpx.Client, base_url: str) -> None:
        self.client = client
        self.base_url = base_url.rstrip("/")

    @classmethod
    def from_settings(cls, client: httpx.Client, settings: Settings) -> "Grobid | None":
        return cls(client, settings.grobid_url) if settings.grobid_url else None

    def _post(self, service: str, pdf: bytes) -> bytes:
        try:
            response = self.client.post(
                f"{self.base_url}/api/{service}",
                files={"input": ("paper.pdf", pdf, "application/pdf")},
                data={"includeRawCitations": "1", "consolidateHeader": "0"},
                headers={"Accept": "application/xml"},
                timeout=TIMEOUT_SECONDS,
            )
        except httpx.HTTPError as exc:
            raise GrobidError(f"GROBID {service} failed: {exc}") from exc
        if response.status_code != httpx.codes.OK:
            raise GrobidError(f"GROBID {service} answered HTTP {response.status_code}")
        return response.content

    def header(self, pdf: bytes) -> GrobidHeader:
        return parse_header(self._post("processHeaderDocument", pdf))

    def references(self, pdf: bytes) -> list[ParsedReference]:
        return parse_references(self._post("processReferences", pdf))

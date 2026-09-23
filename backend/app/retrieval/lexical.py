"""Lexical intent: exact wording, straight from Postgres (§18 deviation).

BM25 ranks terms; it cannot answer "find the exact phrase". `nodes.tsv` is a generated
`to_tsvector('english', heading || ' ' || text)` with a GIN index, so

* a quoted phrase uses `phraseto_tsquery` (lexemes adjacent and in order, index-served)
  and then a case-insensitive substring check on the raw text, so stemming cannot turn
  "stocks and flows" into a match for "stock and flow" when the reader asked for the
  exact words;
* an unquoted lexical query uses `websearch_to_tsquery` (AND of terms, `-not`, "phrases").

Snippets come from `ts_headline`; matches are delimited with private sentinels and
returned as character ranges (`highlights`), so the client never renders markup from
book text.
"""

import re
import uuid
from collections import OrderedDict
from typing import Any

from sqlalchemy import text
from sqlmodel import Session

from app.retrieval.refs import load_refs
from app.schemas.search import SearchFilters, SearchGroup, SearchHit
from app.services.sql import escape_like

HITS_PER_DOC = 5
_START, _STOP = "⦃", "⦄"  # ⦃ ⦄: never in book text, stripped before returning
_HEADLINE = f"StartSel={_START}, StopSel={_STOP}, MaxWords=40, MinWords=12, MaxFragments=2"
_DOC_TEXT = "coalesce(n.heading, '') || ' ' || coalesce(n.text, '')"


def phrase_pattern(phrase: str) -> str:
    """ILIKE pattern for `phrase`, tolerant of whitespace differences only."""
    return "%" + "%".join(escape_like(w) for w in phrase.split()) + "%"


def highlights(marked: str) -> tuple[str, list[tuple[int, int]]]:
    """Strip the sentinels from a headline and return the ranges they delimited."""
    plain: list[str] = []
    ranges: list[tuple[int, int]] = []
    length = 0
    for part in re.split(f"({_START}|{_STOP})", marked):
        if part == _START:
            start = length
        elif part == _STOP:
            ranges.append((start, length))
        else:
            plain.append(part)
            length += len(part)
    return "".join(plain), ranges


def _sql(exact: bool, filters: SearchFilters) -> str:
    tsquery = "phraseto_tsquery" if exact else "websearch_to_tsquery"
    where = ["n.tsv @@ q.q"]
    if exact:
        where.append(f"({_DOC_TEXT}) ilike :pattern escape '\\'")
    if filters.document_ids:
        where.append("n.document_id = any(:ids)")
    if filters.tags:
        where.append("d.tags && cast(:tags as text[])")
    return f"""
        select n.document_id, n.anchor, n.heading,
               ts_rank_cd(n.tsv, q.q) as rank,
               ts_headline('english', {_DOC_TEXT}, q.q, :options) as headline
        from nodes n
        join documents d on d.id = n.document_id
        cross join (select {tsquery}('english', :phrase) as q) q
        where {" and ".join(where)}
        order by rank desc, n.document_id, n.anchor
        limit :cap
    """  # noqa: S608  (fragments are constants; values are bound parameters)


def search(
    session: Session, phrase: str, filters: SearchFilters, *, limit: int, exact: bool
) -> list[SearchGroup]:
    """Nodes containing `phrase`, grouped by document in rank order."""
    params: dict[str, Any] = {
        "phrase": phrase,
        "pattern": phrase_pattern(phrase),
        "options": _HEADLINE,
        "ids": list(filters.document_ids or []),
        "tags": list(filters.tags or []),
        "cap": limit * HITS_PER_DOC * 4,
    }
    rows = session.execute(text(_sql(exact, filters)), params).all()
    grouped: OrderedDict[str, list[SearchHit]] = OrderedDict()
    for row in rows:
        doc_id = str(row.document_id)
        if doc_id not in grouped and len(grouped) >= limit:
            continue
        hits = grouped.setdefault(doc_id, [])
        if len(hits) >= HITS_PER_DOC:
            continue
        snippet, ranges = highlights(" ".join(str(row.headline).split()))
        hits.append(
            SearchHit(
                kind="block",
                anchor=row.anchor,
                heading=row.heading,
                score=float(row.rank),
                snippet=snippet,
                highlights=ranges,
            )
        )
    refs = load_refs(session, [uuid.UUID(i) for i in grouped])
    return [SearchGroup(document=refs[i], hits=hits) for i, hits in grouped.items()]

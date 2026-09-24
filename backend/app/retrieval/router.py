"""Intent routing (§10, D8): address before search.

| Intent     | Rule (first match wins)                                           |
|------------|-------------------------------------------------------------------|
| Addressed  | `<slug>/<anchor>` or `<slug>:<anchor>`; "chapter N [of] X",       |
|            | "section N.M of X", "X chapter N"; "summarize X" naming one doc   |
| Lexical    | a double-quoted phrase; "exact phrase/wording", "verbatim",       |
|            | "word for word"                                                   |
| Synthesis  | "compare", "contrast", "disagree", "differ", "vs", "versus"       |
| Discovery  | everything else                                                   |

The rules need no model. Only when none fires, and a `ModelRunner` was given, one cheap
explore-tier call classifies the query; its reply is cached in-process (LRU) by the
normalised query, and anything going wrong (runner error, timeout, junk JSON, an address
that does not resolve) falls back to Discovery. Addresses are always resolved against
Postgres by `resolve`, never taken from the model verbatim.
"""

import logging
import re
import threading
import uuid
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Any, Literal

from sqlmodel import Session

from app.models import Document
from app.models.enums import Tier
from app.pipeline.runner import ModelRunner, extract_json
from app.retrieval import resolve
from app.schemas.search import Intent, SearchMode

logger = logging.getLogger(__name__)

Source = Literal["mode", "rules", "model", "fallback"]

_NUMBER_WORDS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
    "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13,
    "fourteen": 14, "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18,
    "nineteen": 19, "twenty": 20,
}  # fmt: skip
_ROMAN = {"i": 1, "v": 5, "x": 10, "l": 50, "c": 100}
_NUM = r"\d+|[ivxlc]+|" + "|".join(_NUMBER_WORDS)

_ADDRESS = re.compile(r"\b([a-z0-9][a-z0-9-]*)[:/]([a-z]+\d+(?:/[a-z]+\d+)*)\b")
_CHAPTER = re.compile(rf"\b(?:chapter|ch\.?)\s*({_NUM})(?:\.(\d+))?\b", re.IGNORECASE)
_SECTION = re.compile(r"\bsection\s+(\d+)\.(\d+)\b", re.IGNORECASE)
_OF = re.compile(r"^\s*(?:of|in|from)\s+(.+)$", re.IGNORECASE)
_QUOTED = re.compile(r"[\"“”]([^\"“”]{2,})[\"“”]")
_LEXICAL = re.compile(
    r"\b(?:exact(?:ly)?\s+(?:phrase|wording|words|quote)|verbatim|word\s+for\s+word)\b",
    re.IGNORECASE,
)
_LEXICAL_LEAD = re.compile(
    r"^\s*(?:find|search|where|show)?\s*(?:me\s+)?(?:the\s+)?(?:exact(?:ly)?\s+"
    r"(?:phrase|wording|words|quote)|verbatim|word\s+for\s+word)\s*[:,]?\s*",
    re.IGNORECASE,
)
_SYNTHESIS = re.compile(
    r"\b(?:compare[sd]?|comparison|contrast|disagree[sd]?|agree|differ(?:s|ence|ences)?|"
    r"vs\.?|versus)\b",
    re.IGNORECASE,
)
_SUMMARY = re.compile(
    r"^\s*(?:summari[sz]e|summary\s+of|recap|remind\s+me\s+(?:of|what)|brief\s+(?:of|on|for))"
    r"\s+(.+?)\s*[?.!]*$",
    re.IGNORECASE,
)
_COMMAND = re.compile(
    r"\b(?:summari[sz]e|summary|recap|remind\s+me(?:\s+what)?|what\s+(?:does|did|is)|"
    r"tell\s+me\s+about|said|says|say|about)\b",
    re.IGNORECASE,
)
_SUMMARY_THRESHOLD = 0.85


@dataclass(frozen=True, slots=True)
class Route:
    intent: Intent
    source: Source
    document: Document | None = None
    anchor: str | None = None
    phrase: str | None = None
    document_ids: tuple[uuid.UUID, ...] = field(default=())


def parse_number(token: str) -> int | None:
    token = token.lower()
    if token.isdigit():
        return int(token)
    if token in _NUMBER_WORDS:
        return _NUMBER_WORDS[token]
    if token and all(ch in _ROMAN for ch in token):
        values = [_ROMAN[ch] for ch in token]
        return sum(
            -v if i + 1 < len(values) and v < values[i + 1] else v for i, v in enumerate(values)
        )
    return None


def normalise(query: str) -> str:
    return " ".join(query.lower().split())


# --- Rules ----------------------------------------------------------------------------


def _explicit_address(session: Session, query: str) -> Route | None:
    for slug, anchor in _ADDRESS.findall(query.lower()):
        document = resolve.document_by_slug(session, slug)
        if document is not None and resolve.node_at(session, document.id, anchor) is not None:
            return Route("addressed", "rules", document=document, anchor=anchor)
    return None


def _document_near(session: Session, query: str, start: int, end: int) -> Document | None:
    """The document named after "of/in/from" following the match, else before it."""
    after = _OF.match(query[end:])
    phrases = [after.group(1)] if after else []
    phrases += [_COMMAND.sub(" ", query[:start]), _COMMAND.sub(" ", query[end:])]
    for phrase in phrases:
        match = resolve.match_document(session, phrase)
        if match is not None:
            return match.document
    mentioned = resolve.mentioned_documents(session, query)
    return mentioned[0] if len(mentioned) == 1 else None


def _chapter_address(session: Session, query: str) -> Route | None:
    section: int | None
    found = _SECTION.search(query)
    if found:
        chapter, section = int(found.group(1)), int(found.group(2))
    else:
        found = _CHAPTER.search(query)
        if not found:
            return None
        number = parse_number(found.group(1))
        if number is None:
            return None
        chapter, section = number, int(found.group(2)) if found.group(2) else None
    document = _document_near(session, query, found.start(), found.end())
    if document is None:
        return None
    node = resolve.chapter_node(session, document, chapter, section)
    if node is None:  # the book is known but has no such chapter: search inside it
        return Route("discovery", "rules", document_ids=(document.id,))
    return Route("addressed", "rules", document=document, anchor=node.anchor)


def _summary_address(session: Session, query: str) -> Route | None:
    found = _SUMMARY.match(query)
    if not found:
        return None
    match = resolve.match_document(session, found.group(1), threshold=_SUMMARY_THRESHOLD)
    return Route("addressed", "rules", document=match.document) if match else None


def addressed(session: Session, query: str) -> Route | None:
    return (
        _explicit_address(session, query)
        or _chapter_address(session, query)
        or _summary_address(session, query)
    )


def lexical_phrase(query: str) -> str:
    quoted = _QUOTED.search(query)
    if quoted:
        return quoted.group(1).strip()
    return _LEXICAL_LEAD.sub("", query).strip(" \t'\"?.!") or query.strip()


def is_lexical(query: str) -> bool:
    return bool(_QUOTED.search(query) or _LEXICAL.search(query))


def synthesis(session: Session, query: str, source: Source) -> Route:
    mentioned = resolve.mentioned_documents(session, query)
    ids = tuple(d.id for d in mentioned) if len(mentioned) >= 2 else ()
    return Route("synthesis", source, document_ids=ids)


def by_rules(session: Session, query: str) -> Route | None:
    route = addressed(session, query)
    if route is not None:
        return route
    if is_lexical(query):
        return Route("lexical", "rules", phrase=lexical_phrase(query))
    if _SYNTHESIS.search(query):
        return synthesis(session, query, "rules")
    return None


# --- Model fallback -------------------------------------------------------------------

PROMPT = """Classify a search query against a personal library of books and articles.

Intents:
- addressed: asks about one specific document, or a numbered chapter/section of it.
- lexical: wants the exact wording of a phrase.
- synthesis: compares or relates several documents or authors.
- discovery: anything else ("what do I know about X").

Reply with one JSON object and nothing else:
{"intent": "addressed|lexical|synthesis|discovery", "document": "<title, slug or author, or null>",
 "chapter": <integer or null>, "section": <integer or null>, "phrase": "<exact phrase or null>"}

Query: """


class QueryRouter:
    """Rules first, then an optional cached model call, then Discovery."""

    def __init__(self, runner: ModelRunner | None = None, *, cache_size: int = 256) -> None:
        self.runner = runner
        self.cache_size = cache_size
        self._cache: OrderedDict[str, dict[str, Any]] = OrderedDict()
        self._lock = threading.Lock()

    def route(self, session: Session, query: str, mode: SearchMode = "auto") -> Route:
        if mode == "lexical":
            return Route("lexical", "mode", phrase=lexical_phrase(query))
        if mode == "synthesis":
            return synthesis(session, query, "mode")
        if mode == "discovery":
            return Route("discovery", "mode")
        if mode == "addressed":
            return addressed(session, query) or Route("discovery", "fallback")
        return (
            by_rules(session, query)
            or self._by_model(session, query)
            or Route("discovery", "fallback")
        )

    def _classify(self, query: str) -> dict[str, Any]:
        key = normalise(query)
        with self._lock:
            if key in self._cache:
                self._cache.move_to_end(key)
                return self._cache[key]
        assert self.runner is not None  # noqa: S101  (checked by the caller)
        reply = extract_json(self.runner.run(PROMPT + query, tier=Tier.EXPLORE).text)
        with self._lock:
            self._cache[key] = reply
            while len(self._cache) > self.cache_size:
                self._cache.popitem(last=False)
        return reply

    def _by_model(self, session: Session, query: str) -> Route | None:
        if self.runner is None:
            return None
        # End the rules' read transaction: its pooled connection must not sit idle through a
        # model call (up to its timeout, plus any wait for a free CLI slot).
        session.rollback()
        try:
            reply = self._classify(query)
            return self._from_reply(session, query, reply)
        except Exception as exc:  # any failure means Discovery, never an error
            logger.warning("Query classification failed", extra={"error": str(exc)[:300]})
            return None

    def _from_reply(self, session: Session, query: str, reply: dict[str, Any]) -> Route | None:
        intent = reply.get("intent")
        if intent == "lexical":
            phrase = reply.get("phrase")
            return Route(
                "lexical",
                "model",
                phrase=phrase if isinstance(phrase, str) and phrase else lexical_phrase(query),
            )
        if intent == "synthesis":
            return synthesis(session, query, "model")
        if intent != "addressed" or not isinstance(reply.get("document"), str):
            return None
        match = resolve.match_document(session, reply["document"])
        if match is None:
            return None
        chapter, section = reply.get("chapter"), reply.get("section")
        if not isinstance(chapter, int):
            return Route("addressed", "model", document=match.document)
        node = resolve.chapter_node(
            session, match.document, chapter, section if isinstance(section, int) else None
        )
        if node is None:
            return None
        return Route("addressed", "model", document=match.document, anchor=node.anchor)

"""Cited answer synthesis: search, gather evidence, one `ModelRunner` call, checked cites.

The prompt is inline rather than a `skills/` package: an answer is not an artifact (no
selector, no scope, nothing stored or reviewed), which the skill contract requires.

The reply must be render-contract JSON `{blocks}` whose cites are qualified
`<slug>:<anchor>` keys (see `evidence`). Checking happens in two steps:

1. **Shape** (hard): with qualifiers stripped, the reply must satisfy
   `contracts/render-blocks.schema.json`; `run_structured` retries once with the problems.
2. **Cites** (soft): every cite not in the evidence set is dropped and reported in
   `dropped_cites`. A bare anchor is accepted only when the evidence has one document.

`stream` yields `(event, payload)` pairs for the SSE endpoint: `status` (routing,
searching, writing), `hits` (the `SearchResponse`), then `answer` or `error`.
"""

import copy
import logging
from collections.abc import Iterator, Sequence
from typing import Any

from pydantic import BaseModel
from qdrant_client import QdrantClient
from sqlmodel import Session

from app.core import lifecycle
from app.models.enums import Tier
from app.pipeline.bodies import iter_objects
from app.pipeline.gates import RENDER_BODY_SCHEMA, schema_errors
from app.pipeline.runner import ModelRunner, OutputError, RunnerError, run_structured
from app.retrieval import relations, search
from app.retrieval.embedding import Embedder
from app.retrieval.evidence import Evidence, gather, split_cite
from app.retrieval.router import QueryRouter
from app.schemas.search import (
    AnswerEvent,
    CiteSource,
    ConceptRelation,
    ErrorEvent,
    SearchRequest,
    StatusEvent,
)

logger = logging.getLogger(__name__)

PROMPT = """You answer questions from the reader's own library, using ONLY the evidence below.

## Method
Read the distillations first (they are the reader's approved notes), then the passages
(exact source text). Answer the question directly in 1-4 short paragraphs or a bullet list.
Where documents disagree, say so and attribute each view.

## Hard rules
- Every span carries `cites`: one or more evidence keys of the form `<slug>:<anchor>`,
  copied exactly from the evidence (the bracketed keys). Never invent a key.
- Say nothing the evidence does not support. If it does not answer the question, reply
  with one paragraph saying so, citing the closest evidence.
- Use only these block types: paragraph, bullets, callout, quote, heading (level 3).

## Output
{"blocks": [{"type": "paragraph", "spans": [{"text": "...", "cites": ["<slug>:<anchor>"]}]}]}

Output only the JSON object. No prose, no code fences.
"""


def render_prompt(
    question: str, evidence: Evidence, concept_relations: Sequence[ConceptRelation] = ()
) -> str:
    sections = []
    for item in evidence.items:
        title = f"{item.document.title} ({', '.join(item.document.authors) or 'unknown'})"
        sections.append(f"### [{item.label}] {item.detail} · {title}\n{item.text}")
    body = "\n\n".join(sections)
    graph = relations.prompt_section(concept_relations)
    graph = f"\n{graph}" if graph else ""
    return f"{PROMPT}\n## Question\n\n{question}\n\n## Evidence\n\n{body}\n{graph}"


def _bare(output: dict[str, Any]) -> dict[str, Any]:
    """The reply with `slug:` qualifiers stripped, for the render-contract check."""
    stripped = copy.deepcopy(output)
    for obj in iter_objects(stripped):
        cites = obj.get("cites")
        if isinstance(cites, list):
            obj["cites"] = [split_cite(c)[1] if isinstance(c, str) else c for c in cites]
    return stripped


def shape_problems(output: dict[str, Any]) -> list[str]:
    return schema_errors(RENDER_BODY_SCHEMA, _bare(output))


def check_cites(output: dict[str, Any], evidence: Evidence) -> tuple[list[str], set[str]]:
    """Drop cites outside the evidence set, in place. Returns (dropped, kept keys)."""
    only = evidence.documents[0].slug if len(evidence.documents) == 1 else None
    dropped: list[str] = []
    kept: set[str] = set()
    for obj in iter_objects(output.get("blocks", [])):
        cites = obj.get("cites")
        if not isinstance(cites, list):
            continue
        valid: list[str] = []
        for cite in cites:
            slug, anchor = split_cite(str(cite))
            key = f"{slug or only}:{anchor}"
            if key in evidence.valid and key not in valid:
                valid.append(key)
            elif key not in evidence.valid:
                dropped.append(str(cite))
        obj["cites"] = valid
        kept.update(valid)
    return dropped, kept


def synthesize(
    runner: ModelRunner,
    question: str,
    evidence: Evidence,
    concept_relations: Sequence[ConceptRelation] = (),
) -> AnswerEvent:
    """One `distil`-tier run over the evidence (and, for synthesis, the concept relations
    between the documents). Raises `OutputError` / `RunnerError`."""
    prompt = render_prompt(question, evidence, concept_relations)
    run = run_structured(runner, prompt, tier=Tier.DISTIL, validate=shape_problems)
    output = run.output
    dropped, kept = check_cites(output, evidence)
    sources = {
        key: CiteSource(document=evidence.valid[key][0], anchor=evidence.valid[key][1])
        for key in sorted(kept)
    }
    return AnswerEvent(
        blocks=list(output.get("blocks", [])),
        sources=sources,
        dropped_cites=dropped,
        model=run.model,
    )


Event = tuple[str, BaseModel]


def stream(
    session: Session,
    request: SearchRequest,
    *,
    router: QueryRouter,
    embedder: Embedder,
    runner: ModelRunner,
    client: QdrantClient | None = None,
) -> Iterator[Event]:
    """Progress, hits, then the answer, as `(event, payload)` pairs. Never raises."""
    try:
        yield "status", StatusEvent(stage="routing", message="Reading the question")
        route = router.route(session, request.query, request.mode)
        yield "status", StatusEvent(stage="searching", message=f"Searching ({route.intent})")
        outcome = search.run(
            session, request, router=router, embedder=embedder, client=client, route=route
        )
        yield "hits", outcome.response
        evidence = gather(session, outcome.response)
        if not evidence.items:
            yield "error", ErrorEvent(code="no_evidence", message="Nothing in the library matches.")
            return
        if lifecycle.stopping.is_set():  # do not start a model run the reload would wait on
            yield "error", ErrorEvent(code="shutting_down", message="The server is restarting.")
            return
        yield "status", StatusEvent(stage="writing", message="Writing a cited answer")
        yield "answer", synthesize(runner, request.query, evidence, outcome.response.relations)
    except OutputError as exc:
        yield "error", ErrorEvent(code="invalid_output", message=str(exc)[:500])
    except RunnerError as exc:
        yield "error", ErrorEvent(code="model_failed", message=str(exc)[:500])
    except Exception:  # the stream must end with an event, not a dropped connection
        logger.exception("Answer stream failed")
        yield "error", ErrorEvent(code="internal_error", message="The answer could not be built.")

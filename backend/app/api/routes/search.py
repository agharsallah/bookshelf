"""Search (§10, §13): address-first routing, two-tier hybrid search, cited answers.

* `POST /search` — grouped results. Read-only, so no API key; rules-only routing keeps it
  model-free and fast.
* `POST /search/answer` — Server-Sent Events: `status`, `hits`, then `answer` or `error`.
  It spends model runs, so it is guarded by the API key like any write. Its router may
  ask the explore tier when no rule fires (bounded by `ROUTER_TIMEOUT_SECONDS`).
* `GET /search/suggest?q=` — typeahead from Postgres.

Docs: https://fastapi.tiangolo.com/tutorial/server-sent-events/ (SSE with POST)
"""

from collections.abc import Iterator
from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from fastapi.sse import EventSourceResponse, ServerSentEvent
from qdrant_client import QdrantClient
from sqlmodel import Session

from app.api.deps import SessionDep
from app.core.security import require_api_key
from app.db.session import engine
from app.pipeline.runner import ClaudeCliRunner, ModelRunner
from app.retrieval import answer, search, suggest
from app.retrieval.client import get_client
from app.retrieval.embedding import Embedder, get_embedder
from app.retrieval.router import QueryRouter
from app.schemas.search import SearchRequest, SearchResponse, SuggestResponse

router = APIRouter(prefix="/search", tags=["search"])

ROUTER_TIMEOUT_SECONDS = 20


@lru_cache
def get_search_router() -> QueryRouter:
    """Rules only: `/search` never waits on a model."""
    return QueryRouter()


@lru_cache
def get_answer_router() -> QueryRouter:
    """Rules, then a short, cached explore-tier classification."""
    return QueryRouter(ClaudeCliRunner(timeout_seconds=ROUTER_TIMEOUT_SECONDS))


@lru_cache
def get_answer_runner() -> ModelRunner:
    return ClaudeCliRunner()


def get_qdrant() -> QdrantClient:
    return get_client()


def get_search_embedder() -> Embedder:
    return get_embedder()


EmbedderDep = Annotated[Embedder, Depends(get_search_embedder)]
QdrantDep = Annotated[QdrantClient, Depends(get_qdrant)]


@router.post("", response_model=SearchResponse, summary="Search the library")
def search_library(
    body: SearchRequest,
    session: SessionDep,
    embedder: EmbedderDep,
    client: QdrantDep,
    query_router: Annotated[QueryRouter, Depends(get_search_router)],
) -> SearchResponse:
    """Route the query (addressed, lexical, discovery, synthesis) and return hits grouped
    by document. Addressed queries return the tree node and its approved artifacts."""
    outcome = search.run(session, body, router=query_router, embedder=embedder, client=client)
    return outcome.response


@router.post(
    "/answer",
    response_class=EventSourceResponse,
    dependencies=[Depends(require_api_key)],
    summary="Stream a cited answer (SSE)",
)
def answer_question(
    body: SearchRequest,
    embedder: EmbedderDep,
    client: QdrantDep,
    query_router: Annotated[QueryRouter, Depends(get_answer_router)],
    runner: Annotated[ModelRunner, Depends(get_answer_runner)],
) -> Iterator[ServerSentEvent]:
    """Events: `status` {stage, message} · `hits` (a `SearchResponse`) · `answer`
    {blocks, sources, dropped_cites, model} with cites `<slug>:<anchor>` · `error`
    {code, message}. The stream ends after `answer` or `error`."""
    with Session(engine) as session:
        events = answer.stream(
            session, body, router=query_router, embedder=embedder, runner=runner, client=client
        )
        for event, payload in events:
            yield ServerSentEvent(event=event, data=payload)


@router.get("/suggest", response_model=SuggestResponse, summary="Typeahead suggestions")
def suggest_terms(
    session: SessionDep,
    q: Annotated[str, Query(min_length=1, max_length=100)],
    limit: Annotated[int, Query(ge=1, le=20)] = 10,
) -> SuggestResponse:
    """Document titles, chapter headings and concept names containing `q`."""
    return SuggestResponse(items=suggest.suggest(session, q.strip(), limit=limit))

"""Aggregates every versioned route module into one router.

Docs: https://fastapi.tiangolo.com/tutorial/bigger-applications/
"""

from fastapi import APIRouter

from app.api.routes import (
    artifacts,
    audio,
    concepts,
    documents,
    exports,
    graph,
    job_events,
    jobs,
    library,
    media,
    nodes,
    notes,
    reading,
    search,
    skills,
)

api_router = APIRouter()
api_router.include_router(library.router)
api_router.include_router(documents.router)
api_router.include_router(nodes.router)
api_router.include_router(notes.router)
api_router.include_router(reading.router)
api_router.include_router(job_events.router)  # before jobs: /jobs/stream vs /jobs/{id}
api_router.include_router(jobs.router)
api_router.include_router(exports.router)
api_router.include_router(media.router)
api_router.include_router(audio.router)
api_router.include_router(artifacts.router)
api_router.include_router(skills.router)
api_router.include_router(search.router)
api_router.include_router(concepts.router)
api_router.include_router(graph.router)

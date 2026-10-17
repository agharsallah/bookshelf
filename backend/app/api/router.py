"""Aggregates every versioned route module into one router.

Docs: https://fastapi.tiangolo.com/tutorial/bigger-applications/
"""

from fastapi import APIRouter

from app.api.routes import (
    activity,
    artifacts,
    audio,
    builds,
    collections,
    concepts,
    database,
    documents,
    exports,
    graph,
    job_events,
    jobs,
    library,
    media,
    nodes,
    notes,
    paper_candidates,
    paper_claims,
    paper_compare,
    paper_sets,
    papers,
    pills,
    reader_stats,
    reading,
    recalls,
    reviews,
    search,
    settings,
    skills,
    snapshots,
    stats,
)

api_router = APIRouter()
api_router.include_router(library.router)
api_router.include_router(stats.router)  # before documents: /documents/{ref}/stats
api_router.include_router(reader_stats.router)  # before documents: /documents/{ref}/reader-stats
api_router.include_router(activity.router)
# before any /papers/{ref} router: /papers/candidates is not a ref
api_router.include_router(paper_candidates.router)
api_router.include_router(paper_compare.router)  # /papers/compare is not a ref
api_router.include_router(paper_claims.router)  # /papers/claims/relate is not a ref
api_router.include_router(builds.router)  # /papers/{ref}/builds, /builds/presets before /{id}
api_router.include_router(papers.router)  # after every fixed /papers/<word> router
api_router.include_router(paper_sets.router)
api_router.include_router(collections.router)
api_router.include_router(pills.router)
api_router.include_router(documents.router)
api_router.include_router(nodes.router)
api_router.include_router(notes.router)
api_router.include_router(reading.router)
api_router.include_router(reading.shelf_router)
api_router.include_router(recalls.router)
api_router.include_router(reviews.router)
api_router.include_router(job_events.router)  # before jobs: /jobs/stream vs /jobs/{id}
api_router.include_router(jobs.router)
api_router.include_router(exports.router)
api_router.include_router(media.router)
api_router.include_router(audio.router)
api_router.include_router(artifacts.router)
api_router.include_router(skills.router)
api_router.include_router(settings.router)
api_router.include_router(search.router)
api_router.include_router(concepts.router)
api_router.include_router(graph.router)

# Settings → Database and snapshots: which database the server uses (its host) and the whole
# shelf as one file. Mounted only with `Settings.database_admin` (off for the public demo).
database_router = APIRouter()
database_router.include_router(snapshots.router)  # before database: /database/snapshot
database_router.include_router(database.router)

"""Aggregates every versioned route module into one router.

Docs: https://fastapi.tiangolo.com/tutorial/bigger-applications/
"""

from fastapi import APIRouter

from app.api.routes import artifacts, job_events, jobs, skills

api_router = APIRouter()
api_router.include_router(job_events.router)  # before jobs: /jobs/stream vs /jobs/{id}
api_router.include_router(jobs.router)
api_router.include_router(artifacts.router)
api_router.include_router(skills.router)

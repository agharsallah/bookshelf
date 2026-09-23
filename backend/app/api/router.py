"""Aggregates every versioned route module into one router.

Docs: https://fastapi.tiangolo.com/tutorial/bigger-applications/
"""

from fastapi import APIRouter

from app.api.routes import jobs

api_router = APIRouter()
api_router.include_router(jobs.router)

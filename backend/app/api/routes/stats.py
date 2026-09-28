"""Pipeline statistics: what each book cost in tokens and time, per chapter, stage and
skill, and what to improve (`app.stats`). Read-only; computed on request."""

from fastapi import APIRouter

from app.api.deps import SessionDep, SettingsDep
from app.api.pipeline import SkillsDirDep
from app.api.routes.documents import DocumentRef
from app.schemas.stats import DocumentStats, LibraryStats
from app.services.documents import get_document
from app.stats import service

router = APIRouter(tags=["stats"])


@router.get(
    "/stats",
    response_model=LibraryStats,
    summary="Pipeline statistics for every book",
    description=(
        "One row per book (tokens, time, cost per page and per 1k words, end-to-end "
        "duration), library-wide skill and model figures, and insights ranked by severity."
    ),
)
def get_library_stats(
    session: SessionDep, settings: SettingsDep, skills_dir: SkillsDirDep
) -> LibraryStats:
    return service.library_stats(session, settings=settings, skills_dir=skills_dir)


@router.get(
    "/documents/{ref}/stats",
    response_model=DocumentStats,
    summary="Pipeline statistics for one book",
    description=(
        "The book's size, its initial end-to-end pass and later passes, time per stage "
        "and per chapter, tokens and cost, per-skill quality and reliability, an ETA for "
        "queued work, and insights on what to change."
    ),
)
def get_document_stats(
    ref: DocumentRef, session: SessionDep, settings: SettingsDep, skills_dir: SkillsDirDep
) -> DocumentStats:
    document = get_document(session, ref)
    return service.document_stats(session, document, settings=settings, skills_dir=skills_dir)

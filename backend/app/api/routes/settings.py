"""Server-side settings: which study material a distilled document makes on its own."""

from collections.abc import Mapping

from fastapi import APIRouter, Depends
from sqlmodel import Session

from app.api.deps import SessionDep
from app.api.pipeline import SkillsDirDep
from app.core.security import require_api_key
from app.papers.profile import PAPER_DERIVES
from app.pipeline.skills import Skill, load_catalogue
from app.schemas.settings import (
    AutoDeriveChoice,
    AutoDerivePublic,
    SettingsPublic,
    SettingsUpdate,
)
from app.services import app_settings

router = APIRouter(prefix="/settings", tags=["settings"])

# What a paper made before this was a setting: its by-products, all of them.
PAPER_DEFAULT = [d.skill for d in PAPER_DERIVES]


def _view(session: Session, catalogue: Mapping[str, Skill]) -> SettingsPublic:
    stored = app_settings.stored_auto_derive(session)
    groups = {}
    for group in app_settings.GROUPS:
        on = set(stored.get(group, PAPER_DEFAULT if group == "paper" else []))
        groups[group] = [
            AutoDeriveChoice(skill=name, description=skill.meta.description, enabled=name in on)
            for name, skill in sorted(app_settings.eligible(catalogue, group).items())
        ]
    return SettingsPublic(auto_derive=AutoDerivePublic(**groups))


@router.get("", response_model=SettingsPublic, summary="Get the settings")
def get_settings(session: SessionDep, skills_dir: SkillsDirDep) -> SettingsPublic:
    return _view(session, load_catalogue(skills_dir))


@router.patch(
    "",
    response_model=SettingsPublic,
    dependencies=[Depends(require_api_key)],
    summary="Change the settings",
    description="`auto_derive.book` / `.paper` replace that group's list of skills to queue "
    "once a document is distilled (`422` for one it cannot run on its own); a group left "
    "out is unchanged. Applies to documents distilled from now on.",
)
def update_settings(
    body: SettingsUpdate, session: SessionDep, skills_dir: SkillsDirDep
) -> SettingsPublic:
    catalogue = load_catalogue(skills_dir)
    if body.auto_derive is not None:
        lists = body.auto_derive.model_dump(exclude_none=True)
        app_settings.set_auto_derive(session, lists, catalogue)
    return _view(session, catalogue)

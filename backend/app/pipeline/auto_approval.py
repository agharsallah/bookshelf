"""Auto-approval: a skill's fresh artifact approved on arrival when the `auto_approve`
setting allows it (`services.app_settings`), propagated like a human approval (§7).

The gate record is kept as scored, so a flagged artifact approved under `all` still shows
its `gates.flags`. Human-authored artifacts are approved on arrival anyway (D15).
"""

import logging

from sqlmodel import Session

from app.models import Artifact
from app.models.enums import Origin, Review
from app.pipeline import artifacts, orchestrator
from app.services import app_settings

logger = logging.getLogger(__name__)


def settle(session: Session, artifact: Artifact) -> Artifact:
    """Approve `artifact` if the setting covers its review state; returns it either way."""
    if artifact.origin is not Origin.SKILL:
        return artifact
    if not app_settings.approves(app_settings.auto_approve(session), artifact.review):
        return artifact
    was = artifact.review
    approved = artifacts.set_review(session, artifact, Review.APPROVED)
    logger.info("Artifact auto-approved", extra={"artifact_id": str(approved.id), "was": was.value})
    orchestrator.on_review(session, approved)
    return approved

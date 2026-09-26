"""A book's episodes, as the Listen page shows them: per variant (`15m-conversation-en`),
the script to read (the latest approved version, else the latest one) and its renders."""

from collections.abc import Mapping
from pathlib import Path

from sqlmodel import Session, col, select

from app.audio import store
from app.audio.narration import script_params
from app.models import Artifact, Document
from app.models.enums import ArtifactType, Review
from app.pipeline.artifacts import pick_preferred
from app.pipeline.skills import ParamValue, Skill
from app.schemas.audio import AudioEpisode, AudioRender, AudioScript, AudioShelf, Mark

FILES_ROUTE = "audio/files"
_FORMAT_ORDER = ("narrator", "conversation", "panel", "roundtable")


def render_public(render: store.Render) -> AudioRender:
    return AudioRender(
        key=render.key,
        voices=list(render.voices),
        duration=render.duration,
        sections=[Mark.model_validate(m, from_attributes=True) for m in render.sections],
        turns=[Mark.model_validate(m, from_attributes=True) for m in render.turns],
        url=f"{FILES_ROUTE}/{render.file}",
        engine=dict(render.engine),
        created_at=render.created_at,
    )


def _order(params: Mapping[str, ParamValue]) -> tuple[int, int, str]:
    minutes = params.get("minutes")
    format_ = str(params.get("format", ""))
    rank = _FORMAT_ORDER.index(format_) if format_ in _FORMAT_ORDER else len(_FORMAT_ORDER)
    return (minutes if isinstance(minutes, int) else 0, rank, str(params.get("language", "")))


def shelf(
    session: Session, document: Document, catalogue: Mapping[str, Skill], audio_dir: Path
) -> AudioShelf:
    rows = session.exec(
        select(Artifact)
        .where(
            Artifact.document_id == document.id,
            Artifact.type == ArtifactType.AUDIO_SUMMARY,
            Artifact.review != Review.REJECTED,
        )
        .order_by(col(Artifact.version))
    ).all()
    chosen = pick_preferred(rows, lambda row: row.variant)
    renders: dict[str, list[store.Render]] = {}
    for render in store.list_renders(audio_dir, document.id):
        renders.setdefault(render.artifact_id, []).append(render)
    episodes = [
        AudioEpisode(
            variant=artifact.variant or "",
            params=script_params(catalogue, artifact),
            script=AudioScript.model_validate(artifact, from_attributes=True),
            renders=[render_public(r) for r in renders.get(str(artifact.id), [])],
        )
        for artifact in chosen.values()
    ]
    episodes.sort(key=lambda e: _order(e.params))
    return AudioShelf(document_id=document.id, episodes=episodes)

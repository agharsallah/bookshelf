"""A book's episodes, as the Listen page shows them: per variant (`15m-conversation-en`),
the script to play first (the latest approved version, else the latest one) and its
renders, plus every version of the episode. A forced re-write replaces a script (the old
row becomes `rejected`), but a version that was recorded stays listed with its audio, so
making a new version never loses an old one.

A chapter read aloud (`chapter`) has no versions: its words are the chapter's, and only the
recordings of the words it has now are listed (a re-parse that changed them leaves the old
ones on disk, unlisted, like any derived media)."""

from collections.abc import Mapping
from pathlib import Path

from sqlmodel import Session, col, select

from app.audio import reading, store
from app.audio.sources import Source, script_params
from app.models import Artifact, Document
from app.models.enums import ArtifactType, Review
from app.pipeline.artifacts import pick_preferred
from app.pipeline.skills import ParamValue, Skill
from app.schemas.audio import (
    AudioEpisode,
    AudioRender,
    AudioScript,
    AudioShelf,
    AudioVersion,
    ChapterAudio,
    Mark,
)

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
        )
        .order_by(col(Artifact.version))
    ).all()
    renders: dict[str, list[AudioRender]] = {}
    for render in store.list_renders(audio_dir, document.id):
        renders.setdefault(render.source, []).append(render_public(render))
    live = [row for row in rows if row.review is not Review.REJECTED]
    chosen = pick_preferred(live, lambda row: row.variant)
    # A variant whose every version was replaced or rejected still has its recordings.
    for row in rows:
        if row.variant not in chosen and renders.get(str(row.id)):
            chosen[row.variant] = row

    def version(row: Artifact) -> AudioVersion:
        script = AudioScript.model_validate(row, from_attributes=True)
        return AudioVersion(script=script, renders=renders.get(str(row.id), []))

    episodes = []
    for variant, artifact in chosen.items():
        kept = [
            row
            for row in reversed(rows)
            if row.variant == variant
            and (row.review is not Review.REJECTED or renders.get(str(row.id)))
        ]
        episodes.append(
            AudioEpisode(
                variant=artifact.variant or "",
                params=script_params(catalogue, artifact),
                script=AudioScript.model_validate(artifact, from_attributes=True),
                renders=renders.get(str(artifact.id), []),
                versions=[version(row) for row in kept],
            )
        )
    episodes.sort(key=lambda e: _order(e.params))
    return AudioShelf(document_id=document.id, episodes=episodes)


def chapter(source: Source, audio_dir: Path) -> ChapterAudio:
    """A reading source (`sources.reading_source`) and its recordings of these words."""
    renders = [
        render_public(render)
        for render in store.list_renders(audio_dir, source.document.id, source.folder)
        if render.content == source.content
    ]
    return ChapterAudio(
        anchor=str(source.anchor),
        title=str(source.body.get("title", "")),
        script=dict(source.body),
        words=reading.word_count(source.body),
        renders=renders,
    )

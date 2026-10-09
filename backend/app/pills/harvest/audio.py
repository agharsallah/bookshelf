"""Audio summaries: one turn of an episode, as a clip of its newest render.

An `audio_summary` is a script (`{title, speakers, sections: [{title, turns}]}`); once
voiced, its render's manifest on disk (`app.audio.store`) times every turn. A cited turn
of a fitting length is a listen pill: the clip's bounds, the words said, the section title
as headline. A script that was never voiced yields nothing. Its length is the clip's own.
"""

from app.audio.episodes import FILES_ROUTE
from app.models.enums import PillKind
from app.pills.contract import ListenBody
from app.pills.harvest.base import (
    MAX_SECONDS,
    MIN_SECONDS,
    HarvestInput,
    PillDraft,
    build,
    clean_cites,
    draft,
    items,
    within_bounds,
)


def harvest_audio(inp: HarvestInput) -> list[PillDraft]:
    render = inp.context.renders.get(str(inp.artifact.id))
    if render is None:
        return []
    timing = {(m.section, m.turn): m for m in render.turns if m.turn is not None}
    url = f"{FILES_ROUTE}/{render.file}"
    out: list[PillDraft] = []
    for s, section in enumerate(items(inp.artifact.body.get("sections"))):
        title = section.get("title") if isinstance(section.get("title"), str) else None
        for t, turn in enumerate(items(section.get("turns"))):
            mark = timing.get((s, t))
            text = str(turn.get("text") or "").strip()
            cites = clean_cites(turn.get("cites", []))
            if mark is None or not cites or not within_bounds(text):
                continue
            body = build(
                ListenBody,
                audio_url=url,
                start_ms=round(mark.start * 1000),
                end_ms=round(mark.end * 1000),
                transcript=[{"text": text, "cites": cites}],
            )
            if body is None:
                continue
            seconds = min(max(round(mark.end - mark.start), MIN_SECONDS), MAX_SECONDS)
            pill = draft(
                inp,
                PillKind.LISTEN,
                body,
                content=text,
                cites=cites,
                headline=title,
                seconds=seconds,
            )
            if pill is not None:
                out.append(pill)
    return out

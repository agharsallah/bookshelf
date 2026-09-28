"""`recommend_next`: explain the top reading candidates with the `recommend-next` utility
skill (docs/PAPERS.md §4, §5). Python ranks; the model only explains (P6).

    payload.candidate_ids (top N, best first; queued by candidate_store after a rebuild)
      → selectors.shelf.recommend_input: facts, score_parts, and the shelf passages that
        lead to each (citing sentence, card TL;DR), keyed `<document_id>#<anchor>`
      → recommend-next (tier `reason`) through the `ModelRunner`, validated: one reason per
        candidate, cites only from that candidate's own leads
      → reading_candidates.reason / reason_cites. `score`, `score_parts`, `status` and the
        order are never written here.
"""

import uuid
from collections.abc import Callable
from pathlib import Path
from typing import Any

from sqlmodel import Session

from app.core.config import get_settings
from app.db.session import release
from app.jobs.registry import HandlerResult, PermanentJobError
from app.models import Job, ReadingCandidate
from app.papers.selectors.shelf import LeadsInput, recommend_input
from app.pipeline.gates import schema_errors
from app.pipeline.runner import ModelRunner, OutputError, run_structured
from app.pipeline.skills import Skill, load_skill, render_prompt

SKILL_NAME = "recommend-next"


def checker(skill: Skill, leads: LeadsInput) -> Callable[[Any], list[str]]:
    """Schema problems, then: every candidate explained once, and each cite one of that
    candidate's passages (at least one when it has any)."""
    ids = leads.candidate_ids

    def problems(output: Any) -> list[str]:
        found = schema_errors(skill.schema, output)
        if found or not isinstance(output, dict):
            return found
        reasons = output["reasons"]
        given = [r["candidate_id"] for r in reasons]
        if sorted(given) != sorted(ids):
            return [f"give exactly one reason per candidate: {', '.join(ids)}"]
        out: list[str] = []
        for reason in reasons:
            cid, allowed = reason["candidate_id"], leads.allowed[reason["candidate_id"]]
            if foreign := [c for c in reason["cites"] if c not in allowed]:
                out.append(
                    f"{cid} cites passages that are not among its leads: {', '.join(foreign)}"
                )
            elif allowed and not reason["cites"]:
                out.append(f"{cid} has shelf passages: cite at least one of them")
        return out

    return problems


def store(session: Session, output: dict[str, Any]) -> int:
    """Write each reason and its cites; returns how many candidates were updated. Commits."""
    written = 0
    for reason in output["reasons"]:
        row = session.get(ReadingCandidate, uuid.UUID(reason["candidate_id"]))
        if row is None:  # removed by a rebuild during the run
            continue
        row.reason, row.reason_cites = reason["reason"], list(reason["cites"])
        session.add(row)
        written += 1
    session.commit()
    return written


def recommend(
    session: Session, candidate_ids: list[uuid.UUID], *, runner: ModelRunner, skill: Skill
) -> tuple[int, int | None]:
    """Explain these candidates; returns (reasons written, tokens the run cost)."""
    leads = recommend_input(session, candidate_ids)
    if not leads.candidate_ids:
        return 0, None
    prompt = render_prompt(skill.prompt, leads.inputs)
    release(session)  # no transaction open through the CLI run(s)
    try:
        run = run_structured(runner, prompt, tier=skill.meta.tier, validate=checker(skill, leads))
    except OutputError as exc:
        raise PermanentJobError(f"recommend-next gave no usable reasons: {exc}") from exc
    return store(session, run.output), run.cost_tokens


def run_recommend_job(
    session: Session, job: Job, *, runner: ModelRunner, skills_dir: Path | None = None
) -> HandlerResult:
    """Handler body for `recommend_next`: `payload.candidate_ids`, best first."""
    raw = (job.payload or {}).get("candidate_ids")
    try:
        ids = [uuid.UUID(str(i)) for i in raw]  # type: ignore[union-attr]
    except (TypeError, ValueError) as exc:
        raise PermanentJobError(f"payload.candidate_ids must be uuids: {raw!r}") from exc
    skill = load_skill((skills_dir or get_settings().skills_dir) / SKILL_NAME)
    written, tokens = recommend(session, ids, runner=runner, skill=skill)
    return HandlerResult(result={"candidates": len(ids), "explained": written}, cost_tokens=tokens)

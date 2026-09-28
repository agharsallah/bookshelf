"""`synthesize_papers`: a related-work synthesis of a paper set with the `synthesize-papers`
utility skill (docs/PAPERS.md §4, §5, §7).

    payload.set_id (payload.force re-runs an unchanged input)
      → selectors.sets.set_input: each member's card, claims, results, cites qualified
        `<slug>:<anchor>`, plus the results pivot
      → idempotency: a live (non-rejected) synthesis with the same `input_hash` is returned
        as it is, with no model run
      → synthesize-papers (tier `reason`) through the `ModelRunner`, validated: the render
        contract with qualifiers stripped, every cite `<slug>:<anchor>` of a set member that
        the input offered and the tree still has, every citable member cited
      → a new `paper_syntheses` row: version = previous + 1, review `draft`

Cross-document cites are `<slug>:<anchor>`, the search answer's form
(`app.retrieval.evidence`); the API resolves them through a `sources` map, as the answer
stream does. Graph evidence (`<document_id>#<anchor>`) is a different, id-keyed form.
"""

import copy
import uuid
from collections.abc import Callable
from pathlib import Path
from typing import Any

from sqlmodel import Session, col, func, select

from app.core.config import get_settings
from app.db.session import release
from app.jobs.registry import HandlerResult, PermanentJobError
from app.models import Job, PaperSet, PaperSynthesis
from app.models.enums import Review
from app.papers.selectors.sets import SetInput, set_input
from app.pipeline.bodies import iter_objects
from app.pipeline.gates import RENDER_BLOCKS_ID, RENDER_BODY_SCHEMA, schema_errors
from app.pipeline.hashing import input_hash
from app.pipeline.repair import repair_blocks
from app.pipeline.runner import ModelRunner, OutputError, run_structured
from app.pipeline.skills import Skill, load_skill, render_prompt
from app.retrieval.evidence import split_cite

SKILL_NAME = "synthesize-papers"
MIN_MEMBERS = 2
BLOCK_TYPES = frozenset({"heading", "paragraph", "bullets", "callout", "quote"})
_TABLE_SCHEMA: dict[str, Any] = {"$ref": f"{RENDER_BLOCKS_ID}#/$defs/table"}


def origin(skill: Skill) -> str:
    return f"skill:{SKILL_NAME}@{skill.version}"


def _bare(value: Any) -> Any:
    """`value` with the `<slug>:` qualifiers stripped, for the render-contract check."""
    out = copy.deepcopy(value)
    for obj in iter_objects(out):
        if isinstance(cites := obj.get("cites"), list):
            # dedupe: `a:ch01/p001` and `b:ch01/p001` are one anchor once stripped
            obj["cites"] = list(
                dict.fromkeys(split_cite(c)[1] if isinstance(c, str) else c for c in cites)
            )
    return out


def cites_of(output: Any) -> list[str]:
    """Every cite in `output`, in document order, once."""
    found = (
        c
        for obj in iter_objects(output)
        if isinstance(obj.get("cites"), list)
        for c in obj["cites"]
        if isinstance(c, str)
    )
    return list(dict.fromkeys(found))


def checker(skill: Skill, given: SetInput) -> Callable[[Any], list[str]]:
    """Schema, render contract, cites of the set only, every citable member cited."""

    def problems(output: Any) -> list[str]:
        found = schema_errors(skill.schema, output)
        if found or not isinstance(output, dict):
            return found
        found = schema_errors(RENDER_BODY_SCHEMA, {"blocks": _bare(output["blocks"])})
        found += [f"table: {p}" for p in schema_errors(_TABLE_SCHEMA, _bare(output["table"]))]
        if others := sorted({b["type"] for b in output["blocks"]} - BLOCK_TYPES):
            found.append(
                f"use only {', '.join(sorted(BLOCK_TYPES))} blocks, not {', '.join(others)}"
            )
        if found:
            return found
        cites = cites_of(output)
        if unknown := [c for c in cites if c not in given.valid]:
            return [
                "cite only `<slug>:<anchor>` keys copied from the input; not in it: "
                + ", ".join(unknown[:20])
            ]
        cited = {given.valid[c][0].slug for c in cites}
        if missing := [m.slug for m in given.citable() if m.slug not in cited]:
            return [f"cite every paper of the set at least once; uncited: {', '.join(missing)}"]
        return []

    return problems


def live_synthesis(session: Session, set_id: uuid.UUID, digest: str) -> PaperSynthesis | None:
    """A draft or approved synthesis of this exact input (a rejected one does not count)."""
    return session.exec(
        select(PaperSynthesis)
        .where(
            PaperSynthesis.set_id == set_id,
            PaperSynthesis.input_hash == digest,
            PaperSynthesis.review != Review.REJECTED,
        )
        .order_by(col(PaperSynthesis.version).desc())
    ).first()


def next_version(session: Session, set_id: uuid.UUID) -> int:
    latest = session.exec(
        select(func.max(PaperSynthesis.version)).where(PaperSynthesis.set_id == set_id)
    ).one()
    return int(latest or 0) + 1


def store(
    session: Session,
    set_id: uuid.UUID,
    output: dict[str, Any],
    *,
    digest: str,
    skill: Skill,
    model: str | None,
) -> PaperSynthesis:
    """A new version, `draft`. Commits."""
    row = PaperSynthesis(
        set_id=set_id,
        version=next_version(session, set_id),
        body={"blocks": output["blocks"], "table": output["table"]},
        citations=sorted(cites_of(output)),
        origin=origin(skill),
        model=model,
        input_hash=digest,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def synthesize(
    session: Session, paper_set: PaperSet, *, runner: ModelRunner, skill: Skill, force: bool = False
) -> tuple[PaperSynthesis, bool, int | None]:
    """Synthesize a set; returns (row, whether a model ran, tokens)."""
    given = set_input(session, paper_set)
    if len(given.members) < MIN_MEMBERS:
        raise PermanentJobError(f"a synthesis needs {MIN_MEMBERS}+ papers still on the shelf")
    if not given.valid:
        raise PermanentJobError("no paper of the set has a card, claims or results to cite yet")
    digest = input_hash(SKILL_NAME, str(skill.version), given.inputs)
    if not force and (existing := live_synthesis(session, paper_set.id, digest)) is not None:
        return existing, False, None
    set_id = paper_set.id
    prompt = render_prompt(skill.prompt, given.inputs)
    release(session)  # no transaction open through the CLI run(s)
    try:
        run = run_structured(
            runner,
            prompt,
            tier=skill.meta.tier,
            validate=checker(skill, given),
            repair=repair_blocks,  # the same shape slips as any render-block body
        )
    except OutputError as exc:
        raise PermanentJobError(f"synthesize-papers gave no usable synthesis: {exc}") from exc
    row = store(session, set_id, run.output, digest=digest, skill=skill, model=run.model)
    return row, True, run.cost_tokens


def run_synthesis_job(
    session: Session, job: Job, *, runner: ModelRunner, skills_dir: Path | None = None
) -> HandlerResult:
    """Handler body for `synthesize_papers`: `payload.set_id`, optional `payload.force`."""
    payload = job.payload or {}
    try:
        set_id = uuid.UUID(str(payload.get("set_id")))
    except ValueError as exc:
        raise PermanentJobError(f"payload.set_id is not a uuid: {payload!r}") from exc
    paper_set = session.get(PaperSet, set_id)
    if paper_set is None:
        raise PermanentJobError(f"paper set {set_id} does not exist")
    skill = load_skill((skills_dir or get_settings().skills_dir) / SKILL_NAME)
    row, ran, tokens = synthesize(
        session, paper_set, runner=runner, skill=skill, force=bool(payload.get("force"))
    )
    return HandlerResult(
        result={"set_id": str(set_id), "version": row.version, "synthesis_id": str(row.id),
                "unchanged": not ran},
        cost_tokens=tokens,
    )  # fmt: skip

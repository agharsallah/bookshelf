"""Per-skill and per-model figures: what each skill costs, how often it fails or needs a
second try, and how good its output is by its own gates (§14). These are the numbers a
prompt change should move."""

import re
import uuid
from collections import Counter, defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass

from app.models.enums import JobKind, JobState
from app.schemas.stats import ModelStats, NamedCount, SkillStats
from app.stats.facts import ArtifactFact, CallFact, JobFact
from app.stats.numbers import durations, mean, rate, ratio, rounded
from app.stats.tokens import calls_by_job, job_counts, job_tokens, token_totals

# `payload.mode` of a link_concepts job that runs a utility skill instead.
MODE_SKILLS = {"dedup": "confirm-merge", "bridge": "relate-concepts"}
TOP_FLAGS = 6
TOP_ERRORS = 5
_ERROR_CHARS = 140
_UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I)
_NUMBER = re.compile(r"\d+(\.\d+)?")


def skill_of(job: JobFact, kind_skills: Mapping[JobKind, str]) -> str | None:
    """The skill a job runs; None for plain-Python kinds (parse, embed, export, narrate)."""
    if job.skill:
        return job.skill
    if job.mode in MODE_SKILLS:
        return MODE_SKILLS[job.mode]
    return kind_skills.get(job.kind)


def error_signature(message: str) -> str:
    """An error with its ids and numbers blanked, so repeats of one failure group together."""
    first = message.strip().splitlines()[0] if message.strip() else "unknown error"
    return _NUMBER.sub("#", _UUID.sub("<id>", first))[:_ERROR_CHARS]


def flag_name(flag: str) -> str:
    """`duplicate_of:ch01/s02` → `duplicate_of`."""
    return flag.split(":", 1)[0]


def _top(counter: Counter[str], n: int) -> list[NamedCount]:
    return [NamedCount(name=name, count=count) for name, count in counter.most_common(n)]


@dataclass(frozen=True, slots=True)
class SkillGroup:
    jobs: list[JobFact]
    calls: list[CallFact]
    artifacts: list[ArtifactFact]


def group_by_skill(
    jobs: Iterable[JobFact],
    calls: Iterable[CallFact],
    artifacts: Iterable[ArtifactFact],
    kind_skills: Mapping[JobKind, str],
) -> dict[str, SkillGroup]:
    job_skill: dict[uuid.UUID, str] = {}
    groups: dict[str, SkillGroup] = defaultdict(lambda: SkillGroup([], [], []))
    for job in jobs:
        name = skill_of(job, kind_skills)
        if name is not None:
            job_skill[job.id] = name
            groups[name].jobs.append(job)
    for call in calls:
        name = (job_skill.get(call.job_id) if call.job_id else None) or call.skill
        if name is not None:
            groups[name].calls.append(call)
    for artifact in artifacts:
        groups[artifact.skill].artifacts.append(artifact)
    return dict(groups)


def skill_stats(name: str, group: SkillGroup) -> SkillStats:
    jobs, calls, artifacts = group.jobs, group.calls, group.artifacts
    counts = job_counts(jobs)
    by_job = calls_by_job(calls)
    done = [j for j in jobs if j.state is JobState.DONE]
    done_tokens = [job_tokens(j, by_job.get(j.id, [])) for j in done]
    groundings = [a.grounding for a in artifacts if a.grounding is not None]
    words = [a.words for a in artifacts if a.words is not None]
    errors = Counter(
        error_signature(j.error) for j in jobs if j.state is JobState.FAILED and j.error
    )
    flags = Counter(flag_name(f) for a in artifacts for f in a.flags)
    models = {a.model for a in artifacts} | {j.model for j in jobs} | {c.model for c in calls}
    tiers = {a.tier for a in artifacts} | {c.tier for c in calls}
    return SkillStats(
        skill=name,
        versions=sorted({a.skill_version for a in artifacts if a.skill_version}),
        tiers=sorted(t for t in tiers if t),
        models=sorted(m for m in models if m),
        jobs=counts,
        calls=len(calls) + sum(1 for j in jobs if j.tokens and not by_job.get(j.id)),
        tokens=token_totals(jobs, calls),
        duration=durations(j.duration_ms for j in done),
        tokens_per_job=rounded(mean(done_tokens), 1),
        failure_rate=rounded(rate(counts.failed, counts.done + counts.failed)),
        cache_hit_rate=rounded(rate(counts.skipped, counts.done + counts.skipped)),
        schema_retry_rate=rounded(rate(sum(a.schema_retry for a in artifacts), len(artifacts))),
        repair_rate=rounded(rate(sum(a.repairs > 0 for a in artifacts), len(artifacts))),
        needs_review_rate=rounded(rate(sum(bool(a.flags) for a in artifacts), len(artifacts))),
        grounding_mean=rounded(mean(groundings)),
        grounding_min=rounded(min(groundings)) if groundings else None,
        words_out_mean=rounded(mean(words), 1),
        tokens_per_output_word=rounded(ratio(sum(done_tokens), sum(words)), 1),
        prompt_chars_mean=rounded(mean([c.prompt_chars for c in calls]), 0),
        artifacts=len(artifacts),
        flags=_top(flags, TOP_FLAGS),
        errors=_top(errors, TOP_ERRORS),
    )


def all_skill_stats(
    jobs: Sequence[JobFact],
    calls: Sequence[CallFact],
    artifacts: Sequence[ArtifactFact],
    kind_skills: Mapping[JobKind, str],
) -> list[SkillStats]:
    """Every skill that ran or made an artifact, the most tokens first."""
    groups = group_by_skill(jobs, calls, artifacts, kind_skills)
    stats = [skill_stats(name, group) for name, group in groups.items()]
    return sorted(stats, key=lambda s: (-s.tokens.tokens, s.skill))


@dataclass(frozen=True, slots=True)
class _Use:
    model: str
    tier: str | None
    tokens: int
    duration_ms: int | None
    cost_usd: float | None


def _uses(jobs: Sequence[JobFact], calls: Sequence[CallFact]) -> list[_Use]:
    """Recorded calls as they are; a job from before telemetry as one call of its model."""
    by_job = calls_by_job(calls)
    uses = [_Use(c.model, c.tier, c.tokens, c.duration_ms, c.cost_usd) for c in calls if c.model]
    for job in jobs:
        if job.model and not by_job.get(job.id):
            uses.append(_Use(job.model, None, job.tokens or 0, job.duration_ms, None))
    return uses


def model_stats(jobs: Sequence[JobFact], calls: Sequence[CallFact]) -> list[ModelStats]:
    grouped: dict[str, list[_Use]] = defaultdict(list)
    for use in _uses(jobs, calls):
        grouped[use.model].append(use)
    out = []
    for model, uses in grouped.items():
        costs = [u.cost_usd for u in uses if u.cost_usd is not None]
        out.append(
            ModelStats(
                model=model,
                tiers=sorted({u.tier for u in uses if u.tier}),
                calls=len(uses),
                tokens=sum(u.tokens for u in uses),
                cost_usd=round(sum(costs), 6) if costs else None,
                duration=durations(u.duration_ms for u in uses),
            )
        )
    return sorted(out, key=lambda m: (-m.tokens, m.model))

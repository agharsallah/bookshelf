"""Per-chapter figures: what each chapter cost and how its outputs scored.

Every job, call and artifact with an anchor belongs to the chapter whose anchor is its
longest prefix (`pt01/ch03/s02` → `pt01/ch03`); book-level work (brief, links, embed)
belongs to no chapter. Dividing by the chapter's words and pages is what makes chapters
of different lengths comparable, and outliers visible.
"""

from collections import defaultdict
from collections.abc import Iterable, Sequence

from app.models.enums import ArtifactType
from app.schemas.stats import ChapterStats
from app.stats.facts import ArtifactFact, CallFact, ChapterFact, JobFact
from app.stats.numbers import mean, ratio, rounded
from app.stats.tokens import calls_by_job, job_counts, job_tokens


class ChapterIndex:
    """Resolve any anchor to the chapter it lies in."""

    def __init__(self, chapters: Iterable[ChapterFact]) -> None:
        # Longest first, so a nested anchor never matches a shorter sibling prefix.
        self._anchors = sorted((c.anchor for c in chapters), key=len, reverse=True)

    def chapter_of(self, anchor: str | None) -> str | None:
        if not anchor:
            return None
        return next((c for c in self._anchors if anchor == c or anchor.startswith(c + "/")), None)


def chapter_stats(
    chapters: Sequence[ChapterFact],
    jobs: Sequence[JobFact],
    calls: Sequence[CallFact],
    artifacts: Sequence[ArtifactFact],
) -> list[ChapterStats]:
    index = ChapterIndex(chapters)
    jobs_in: dict[str, list[JobFact]] = defaultdict(list)
    for job in jobs:
        if (home := index.chapter_of(job.anchor)) is not None:
            jobs_in[home].append(job)
    artifacts_in: dict[str, list[ArtifactFact]] = defaultdict(list)
    for artifact in artifacts:
        if (home := index.chapter_of(artifact.anchor)) is not None:
            artifacts_in[home].append(artifact)
    by_job = calls_by_job(calls)

    out = []
    for chapter in chapters:
        group = jobs_in.get(chapter.anchor, [])
        made = artifacts_in.get(chapter.anchor, [])
        ran = [j for j in group if j.ran]
        ms_by_kind: dict[str, int] = defaultdict(int)
        for job in ran:
            ms_by_kind[job.kind.value] += job.duration_ms or 0
        compute = sum(ms_by_kind.values())
        tokens = sum(job_tokens(j, by_job.get(j.id, [])) for j in group)
        distillation = next(
            (a for a in reversed(made) if a.type == ArtifactType.CHAPTER_DISTILLATION.value
             and a.anchor == chapter.anchor),
            None,
        )  # fmt: skip
        groundings = [a.grounding for a in made if a.grounding is not None]
        out.append(
            ChapterStats(
                anchor=chapter.anchor,
                title=chapter.title,
                ordinal=chapter.position,
                page_from=chapter.page_from,
                page_to=chapter.page_to,
                pages=chapter.pages,
                words=chapter.words,
                sections=chapter.sections,
                elements=chapter.elements,
                jobs=job_counts(group),
                calls=sum(len(by_job.get(j.id, [])) or (1 if j.tokens else 0) for j in group),
                tokens=tokens,
                compute_ms=compute,
                ms_by_kind=dict(ms_by_kind),
                tokens_per_1k_words=rounded(ratio(tokens, chapter.words / 1000), 1),
                seconds_per_page=rounded(ratio(compute / 1000, chapter.pages), 1),
                grounding=rounded(mean(groundings)),
                needs_review=sum(1 for a in made if a.flags),
                compression=rounded(distillation.compression) if distillation else None,
                words_out=sum(a.words or 0 for a in made),
            )
        )
    return out

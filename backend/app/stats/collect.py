"""Load the facts statistics are computed from: one query per table, for many books at once.

Only the columns statistics read are selected (never artifact bodies or block text beyond
a word count), so the library view stays one round trip per table however large it grows.
"""

import uuid
from collections import defaultdict
from collections.abc import Sequence
from typing import Any

from sqlalchemy import text
from sqlmodel import Session

from app.models import Document
from app.models.enums import JobKind, JobState, Review
from app.stats.facts import ArtifactFact, BookFacts, CallFact, ChapterFact, JobFact, Shape

ELEMENT_KINDS = ("figure", "table", "code", "math")
_WORDS = "coalesce(array_length(regexp_split_to_array(btrim({col}), '\\s+'), 1), 0)"

_JOBS = text(
    """
    select id, document_id, kind, state, anchor, skill, payload->>'mode', attempts, error,
           cost_tokens, duration_ms, result->>'model', created_at, started_at, finished_at
    from jobs where document_id = any(:ids)
    """
)

_CALLS = text(
    """
    select job_id, document_id, kind, skill, tier, model, attempt, call, ok, error,
           input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
           cost_usd::float8, duration_ms, prompt_chars, created_at
    from model_runs where document_id = any(:ids)
    """
)

_ARTIFACTS = text(
    """
    select document_id, anchor, type, skill, skill_version, tier, model, review,
           case jsonb_typeof(gates->'grounding') when 'number'
                then (gates->>'grounding')::float8 end,
           case jsonb_typeof(gates->'compression') when 'number'
                then (gates->>'compression')::float8 end,
           case jsonb_typeof(gates->'words') when 'number' then (gates->>'words')::int end,
           coalesce(gates->>'schema_retry' = 'true', false),
           case jsonb_typeof(gates->'repairs') when 'array'
                then jsonb_array_length(gates->'repairs') else 0 end,
           case jsonb_typeof(gates->'flags') when 'array'
                then array(select jsonb_array_elements_text(gates->'flags'))
                else '{}'::text[] end,
           created_at
    from artifacts where origin = 'skill' and document_id = any(:ids)
    """
)

# Parts and chapters, for reading order (ordinals are per parent).
_CONTAINERS = text(
    """
    select id, document_id, parent_id, kind, ordinal
    from nodes where kind in ('part', 'chapter') and document_id = any(:ids)
    """
)

_CHAPTERS = text(
    f"""
    select c.id, c.document_id, c.anchor, c.heading, c.page_from, c.page_to,
           coalesce(c.meta->>'skip' = 'true', false),
           count(n.id) filter (where n.kind = 'section'),
           count(n.id) filter (where n.kind in ('figure', 'table', 'code', 'math')),
           coalesce(sum({_WORDS.format(col="n.text")}) filter (where n.text is not null), 0)
    from nodes c
    left join nodes n on n.document_id = c.document_id and starts_with(n.anchor, c.anchor || '/')
    where c.kind = 'chapter' and c.document_id = any(:ids)
    group by c.id
    """  # noqa: S608  (constant SQL fragment)
)

_SHAPE = text(
    f"""
    select document_id, kind, count(*),
           coalesce(sum({_WORDS.format(col="text")}) filter (where text is not null), 0)
    from nodes where document_id = any(:ids)
    group by document_id, kind
    """  # noqa: S608  (constant SQL fragment)
)


def _rows(session: Session, query: Any, ids: Sequence[uuid.UUID]) -> list[Any]:
    return list(session.execute(query, {"ids": list(ids)}).all())


def _jobs(rows: list[Any]) -> dict[uuid.UUID, list[JobFact]]:
    out: dict[uuid.UUID, list[JobFact]] = defaultdict(list)
    for r in rows:
        out[r[1]].append(
            JobFact(
                id=r[0],
                document_id=r[1],
                kind=JobKind(r[2]),
                state=JobState(r[3]),
                anchor=r[4],
                skill=r[5],
                mode=r[6],
                attempts=r[7],
                error=r[8],
                tokens=r[9],
                duration_ms=r[10],
                model=r[11],
                created_at=r[12],
                started_at=r[13],
                finished_at=r[14],
            )
        )
    return out


def _calls(rows: list[Any]) -> dict[uuid.UUID, list[CallFact]]:
    out: dict[uuid.UUID, list[CallFact]] = defaultdict(list)
    for r in rows:
        out[r[1]].append(
            CallFact(
                job_id=r[0],
                document_id=r[1],
                kind=JobKind(r[2]),
                skill=r[3],
                tier=r[4],
                model=r[5],
                attempt=r[6],
                call=r[7],
                ok=r[8],
                error=r[9],
                input_tokens=r[10],
                output_tokens=r[11],
                cache_read_tokens=r[12],
                cache_write_tokens=r[13],
                cost_usd=r[14],
                duration_ms=r[15],
                prompt_chars=r[16],
                created_at=r[17],
            )
        )
    return out


def _artifacts(rows: list[Any]) -> dict[uuid.UUID, list[ArtifactFact]]:
    out: dict[uuid.UUID, list[ArtifactFact]] = defaultdict(list)
    for r in rows:
        out[r[0]].append(
            ArtifactFact(
                document_id=r[0],
                anchor=r[1],
                type=r[2],
                skill=r[3],
                skill_version=r[4],
                tier=r[5],
                model=r[6],
                review=Review(r[7]),
                grounding=r[8],
                compression=r[9],
                words=r[10],
                schema_retry=bool(r[11]),
                repairs=int(r[12]),
                flags=tuple(r[13] or ()),
                created_at=r[14],
            )
        )
    return out


def reading_order(containers: list[Any]) -> dict[uuid.UUID, tuple[int, ...]]:
    """Each part or chapter's position as a path of ordinals from its top-level container,
    so `pt02/ch01` sorts after `pt01/ch09` and front matter stays first."""
    parent = {r[0]: r[2] for r in containers}
    ordinal = {r[0]: r[4] for r in containers}
    paths: dict[uuid.UUID, tuple[int, ...]] = {}
    for node_id in parent:
        path: list[int] = []
        current: uuid.UUID | None = node_id
        while current is not None and current in ordinal:
            path.append(ordinal[current])
            current = parent[current]
        paths[node_id] = tuple(reversed(path))
    return paths


def _chapters(
    rows: list[Any], order: dict[uuid.UUID, tuple[int, ...]]
) -> dict[uuid.UUID, list[ChapterFact]]:
    grouped: dict[uuid.UUID, list[Any]] = defaultdict(list)
    for r in rows:
        grouped[r[1]].append(r)
    out: dict[uuid.UUID, list[ChapterFact]] = {}
    for document_id, chapter_rows in grouped.items():
        chapter_rows.sort(key=lambda r: order.get(r[0], ()))
        out[document_id] = [
            ChapterFact(
                anchor=r[2],
                title=r[3],
                position=i,
                page_from=r[4],
                page_to=r[5],
                skipped=bool(r[6]),
                sections=int(r[7]),
                elements=int(r[8]),
                words=int(r[9]),
            )
            for i, r in enumerate(chapter_rows)
        ]
    return out


def _shapes(rows: list[Any]) -> dict[uuid.UUID, Shape]:
    words: dict[uuid.UUID, int] = defaultdict(int)
    blocks: dict[uuid.UUID, int] = defaultdict(int)
    sections: dict[uuid.UUID, int] = defaultdict(int)
    elements: dict[uuid.UUID, dict[str, int]] = defaultdict(dict)
    for document_id, kind, count, kind_words in rows:
        words[document_id] += int(kind_words)
        if kind == "section":
            sections[document_id] += int(count)
        elif kind not in ("part", "chapter"):
            blocks[document_id] += int(count)
        if kind in ELEMENT_KINDS:
            elements[document_id][kind] = int(count)
    ids = set(words) | set(blocks)
    return {
        d: Shape(words=words[d], blocks=blocks[d], sections=sections[d], elements=elements[d])
        for d in ids
    }


def load_books(session: Session, documents: Sequence[Document]) -> list[BookFacts]:
    """Every fact about `documents`, in their order."""
    ids = [d.id for d in documents]
    if not ids:
        return []
    jobs = _jobs(_rows(session, _JOBS, ids))
    calls = _calls(_rows(session, _CALLS, ids))
    artifacts = _artifacts(_rows(session, _ARTIFACTS, ids))
    chapters = _chapters(
        _rows(session, _CHAPTERS, ids), reading_order(_rows(session, _CONTAINERS, ids))
    )
    shapes = _shapes(_rows(session, _SHAPE, ids))
    return [
        BookFacts(
            document=d,
            shape=shapes.get(d.id, Shape()),
            chapters=chapters.get(d.id, []),
            jobs=jobs.get(d.id, []),
            calls=calls.get(d.id, []),
            artifacts=artifacts.get(d.id, []),
        )
        for d in documents
    ]

import { describe, expect, it } from 'vitest';
import type { ArtifactPublic } from '../api/types/artifacts';
import type { TreeNode } from '../api/types/documents';
import { chapterStatus, pickBest, pickBestUnder } from './artifacts';
import { fetchAll } from '../api/fetch-all';
import { pipelineFraction, stepState } from './pipeline';
import { defaultUnit, flatten, isUnder, pageSpan, readingUnits, unitFor } from './tree';

function artifact(overrides: Partial<ArtifactPublic>): ArtifactPublic {
  return {
    id: `${overrides.type}-${overrides.anchor}-${overrides.version}`,
    document_id: 'd1',
    anchor: 'ch01',
    note_id: null,
    type: 'chapter_distillation',
    version: 1,
    origin: 'skill',
    skill: null,
    skill_version: null,
    model: null,
    run_mode: null,
    tier: null,
    input_hash: 'h',
    body: { blocks: [] },
    citations: [],
    gates: {},
    review: 'draft',
    reviewed_at: null,
    created_at: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

describe('pickBest', () => {
  it('prefers an approved version over a newer draft', () => {
    const chosen = pickBest(
      [artifact({ version: 1, review: 'approved' }), artifact({ version: 2, review: 'draft' })],
      'chapter_distillation',
      'ch01',
    );
    expect([chosen?.artifact.version, chosen?.standing]).toEqual([1, 'approved']);
  });

  it('falls back to the newest unapproved version, never a rejected one', () => {
    const chosen = pickBest(
      [artifact({ version: 1 }), artifact({ version: 3, review: 'rejected' }), artifact({ version: 2, review: 'needs_review' })],
      'chapter_distillation',
      'ch01',
    );
    expect([chosen?.artifact.version, chosen?.standing]).toEqual([2, 'needs_review']);
  });

  it('matches the scope exactly', () => {
    expect(pickBest([artifact({ anchor: 'ch01/s01' })], 'chapter_distillation', 'ch01')).toBeNull();
  });
});

describe('pickBestUnder', () => {
  it('returns one version per anchor under the prefix, in natural order', () => {
    const list = [
      artifact({ type: 'section_note', anchor: 'ch01/s10', version: 1 }),
      artifact({ type: 'section_note', anchor: 'ch01/s02', version: 1 }),
      artifact({ type: 'section_note', anchor: 'ch01/s02', version: 2 }),
      artifact({ type: 'section_note', anchor: 'ch10/s01', version: 1 }),
    ];
    expect(pickBestUnder(list, 'section_note', 'ch01').map((c) => c.artifact.id)).toEqual([
      'section_note-ch01/s02-2',
      'section_note-ch01/s10-1',
    ]);
  });
});

describe('chapterStatus', () => {
  it('reports summary and distillation standing and counts unapproved work', () => {
    const status = chapterStatus(
      [
        artifact({ type: 'chapter_summary', review: 'approved' }),
        artifact({ type: 'section_note', anchor: 'ch01/s01' }),
        artifact({ type: 'section_note', anchor: 'ch01/s01', version: 2 }),
        artifact({ type: 'figure_description', anchor: 'ch01/f001', review: 'needs_review' }),
        artifact({ type: 'section_note', anchor: 'ch02/s01' }),
      ],
      'ch01',
    );
    expect(status).toEqual({ summary: 'approved', distillation: null, waiting: 2 });
  });
});

describe('pipeline', () => {
  it('marks milestones done, current and in progress', () => {
    expect([0, 1, 2, 3, 4].map((i) => stepState('distilling', i))).toEqual(['done', 'current', 'working', 'todo', 'todo']);
  });

  it('puts a parse failure on the parse step and a review on the step reached', () => {
    expect([0, 1].map((i) => stepState('parse_failed', i))).toEqual(['current', 'failed']);
    expect([0, 1, 2].map((i) => stepState('needs_review', i))).toEqual(['done', 'review', 'todo']);
  });

  it('measures progress from 0 to 1', () => {
    expect([pipelineFraction('registered'), pipelineFraction('parsing'), pipelineFraction('linked')]).toEqual([0, 0.125, 1]);
  });
});

function node(anchor: string, kind: TreeNode['kind'], children: TreeNode[] = [], meta = {}): TreeNode {
  return { id: anchor, anchor, kind, ordinal: 0, depth: 0, heading: anchor, text: null, page_from: null, page_to: null, meta, children };
}

describe('tree', () => {
  const tree = [
    node('fm01', 'chapter', [], { front_matter: true }),
    node('pt01', 'part', [node('pt01/ch01', 'chapter', [node('pt01/ch01/s01', 'section', [node('pt01/ch01/s01/p001', 'paragraph')]), node('pt01/ch01/p001', 'paragraph')])]),
    node('ch02', 'chapter'),
  ];
  const units = readingUnits(tree);

  it('lists chapters inside parts in reading order and opens on the first real one', () => {
    expect(units.map((u) => u.anchor)).toEqual(['fm01', 'pt01/ch01', 'ch02']);
    expect(defaultUnit(units)?.anchor).toBe('pt01/ch01');
  });

  it('finds the unit for a deep anchor, and a part’s first chapter', () => {
    expect(unitFor(units, 'pt01/ch01/s01/p001')?.anchor).toBe('pt01/ch01');
    expect(unitFor(units, 'pt01')?.anchor).toBe('pt01/ch01');
    expect(unitFor(units, 'ch09')).toBeUndefined();
  });

  it('flattens a unit with each node’s section', () => {
    expect(flatten(units[1]!).map((f) => [f.node.anchor, f.section])).toEqual([
      ['pt01/ch01/s01', 'pt01/ch01/s01'],
      ['pt01/ch01/s01/p001', 'pt01/ch01/s01'],
      ['pt01/ch01/p001', 'pt01/ch01'],
    ]);
  });

  it('matches anchors by whole segments', () => {
    expect([isUnder('ch1/p1', 'ch1'), isUnder('ch10', 'ch1'), isUnder('ch1', 'ch1')]).toEqual([true, false, true]);
  });

  it('formats page spans', () => {
    expect([pageSpan({ page_from: 3, page_to: 8 }), pageSpan({ page_from: 3, page_to: 3 }), pageSpan({ page_from: null, page_to: null })]).toEqual([
      'pp. 3–8',
      'p. 3',
      '',
    ]);
  });
});

describe('fetchAll', () => {
  it('follows offsets until the total is reached', async () => {
    const offsets: unknown[] = [];
    const api = {
      get: <T,>(_path: string, options?: { query?: Record<string, unknown> }) => {
        const offset = Number(options?.query?.offset);
        offsets.push(offset);
        const items = Array.from({ length: offset === 0 ? 100 : 30 }, (_, i) => offset + i);
        return Promise.resolve({ items, total: 130, limit: 100, offset } as T);
      },
    };
    const result = await fetchAll<number>(api, 'notes');
    expect([result.items.length, result.complete, offsets]).toEqual([130, true, [0, 100]]);
  });
});

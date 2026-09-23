import { describe, expect, it } from 'vitest';
import type { Artifact } from '../../lib/api/types/artifacts';
import type { NoteDetail } from '../../lib/api/types/notes';
import { groupMarks, marksFor, notedBlocks } from './marks';
import { bodyBlocks, buildPanes } from './panes';

function artifact(overrides: Partial<Artifact>): Artifact {
  return {
    id: `${overrides.type}@${overrides.anchor}#${overrides.version ?? 1}`, document_id: 'd', anchor: 'ch01', note_id: null,
    type: 'chapter_distillation', version: 1, origin: 'skill', skill: null, skill_version: null, model: null, run_mode: null,
    tier: null, input_hash: 'h', body: { blocks: [] }, citations: [], gates: {}, review: 'approved', reviewed_at: null,
    created_at: '2026-01-01T00:00:00Z', ...overrides,
  };
}

describe('buildPanes', () => {
  const panes = buildPanes(
    [
      artifact({ type: 'chapter_distillation', review: 'draft' }),
      artifact({ type: 'section_note', anchor: 'ch01/s02' }),
      artifact({ type: 'section_note', anchor: 'ch01/s01' }),
      artifact({ type: 'table_explanation', anchor: 'ch01/s02/t001' }),
      artifact({ type: 'figure_description', anchor: 'ch01/s01/f001', body: { caption: 'Figure 1.1', blocks: [] } }),
      artifact({ type: 'section_note', anchor: 'ch02/s01' }),
    ],
    'ch01',
    { 'ch01/s01': 'Why it lags', 'ch01/s02': 'What to do', 'ch01/s02/t001': 'Table 1.1' },
  );

  it('shows an unapproved distillation as a draft and no summary when there is none', () => {
    expect([panes.distillation?.standing, panes.summary]).toEqual(['draft', null]);
  });

  it('lists section notes of this chapter only, in order, titled by their section', () => {
    expect(panes.sections.map((s) => [s.anchor, s.title])).toEqual([
      ['ch01/s01', 'Why it lags'],
      ['ch01/s02', 'What to do'],
    ]);
  });

  it('orders explanations by the block they explain, titled by caption', () => {
    expect(panes.figures.map((f) => [f.anchor, f.title])).toEqual([
      ['ch01/s01/f001', 'Figure 1.1'],
      ['ch01/s02/t001', 'Table 1.1'],
    ]);
  });
});

describe('bodyBlocks', () => {
  it('appends a takeaway as an insight callout', () => {
    const takeaway = { text: 'Waits explode past 80%.', cites: ['ch03/f001'] };
    expect(bodyBlocks({ blocks: [], takeaway })).toEqual([{ type: 'callout', tone: 'insight', title: 'Takeaway', spans: [takeaway] }]);
  });

  it('ignores a body without blocks', () => {
    expect(bodyBlocks({ sections: [] })).toEqual([]);
  });
});

const note = (o: Partial<NoteDetail>): NoteDetail => ({
  id: 'n', document_id: 'd', anchor: 'ch01/p001', range: { start: 0, end: 3 }, raw: 'r', color: 'sky',
  created_at: '2026-01-01T00:00:00Z', structured: null, detached: false, ...o,
});

describe('groupMarks', () => {
  it('groups ranged, attached notes by anchor, oldest first, defaulting the colour', () => {
    const groups = groupMarks([
      note({ id: 'b', created_at: '2026-02-01T00:00:00Z', color: null }),
      note({ id: 'a' }),
      note({ id: 'c', range: null }),
      note({ id: 'd', detached: true }),
    ]);
    expect(marksFor(groups, 'ch01/p001').map((m) => [m.id, m.color])).toEqual([['a', 'sky'], ['b', 'amber']]);
  });

  it('keeps the previous array for an unchanged block so it does not re-render', () => {
    const first = groupMarks([note({ id: 'a' }), note({ id: 'x', anchor: 'ch01/p002' })]);
    const second = groupMarks([note({ id: 'a' }), note({ id: 'x', anchor: 'ch01/p002', color: 'rose' })], first);
    expect(marksFor(second, 'ch01/p001')).toBe(marksFor(first, 'ch01/p001'));
    expect(marksFor(second, 'ch01/p002')).not.toBe(marksFor(first, 'ch01/p002'));
  });

  it('lists blocks with whole-block notes', () => {
    expect([...notedBlocks([note({ range: null }), note({ anchor: 'ch01/p009' })])]).toEqual(['ch01/p001']);
  });
});

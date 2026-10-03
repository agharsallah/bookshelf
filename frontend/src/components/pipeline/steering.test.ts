import { describe, expect, it } from 'vitest';
import type { QueueStatus } from '../../lib/api/types/jobs';
import { steeringChips, steeringGroups, steeringRows } from './steering';

const queue = (over: Partial<QueueStatus> = {}): QueueStatus => ({ workers: [], queued: 0, running: 0, unclaimed_kinds: [], paused: false, max_running: null, slots: 2, ...over });

describe('steeringRows', () => {
  it('lists kinds with queued work and kinds already steered, in pipeline order, saying which may be skipped', () => {
    const rows = steeringRows(queue({ queued_kinds: { embed: 3, describe_figure: 12 }, kinds: { brief: 'hold' }, skippable_kinds: ['describe_figure'] }));

    expect(rows.map((r) => [r.kind, r.queued, r.mode, r.skippable])).toEqual([
      ['describe_figure', 12, null, true],
      ['brief', 0, 'hold', false],
      ['embed', 3, null, false],
    ]);
  });
});

describe('steeringGroups', () => {
  it('puts each kind under its stage, and the rest under papers and other', () => {
    const rows = steeringRows(queue({ queued_kinds: { describe_figure: 1, embed: 2, dissect_paper: 3 } }));
    expect(steeringGroups(rows).map((g) => [g.label, g.rows.map((r) => r.kind)])).toEqual([
      ['Enrich', ['describe_figure']],
      ['Index', ['embed']],
      ['Papers and other', ['dissect_paper']],
    ]);
  });
});

describe('steeringChips', () => {
  it('gives each active choice the update that undoes only it', () => {
    const chips = steeringChips(queue({ kinds: { embed: 'first' }, first_documents: ['d1', 'd2'] }), (id) => (id === 'd1' ? 'Attention' : 'DDIA'));
    expect(chips.map((c) => [c.text, c.clear])).toEqual([
      ['Embed first', { kinds: { embed: null } }],
      ['Attention first', { first_documents: ['d2'] }],
      ['DDIA first', { first_documents: ['d1'] }],
    ]);
  });
});

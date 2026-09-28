import { describe, expect, it } from 'vitest';
import type { ArtifactPublic } from '../../lib/api/types/artifacts';
import { explainRequest, levelOptions } from './explain';

const explainer = (variant: string, review: ArtifactPublic['review'], version = 1): ArtifactPublic => ({
  id: `${variant}-${version}`,
  document_id: 'd1',
  anchor: null,
  note_id: null,
  variant,
  type: 'paper_explainer',
  version,
  origin: 'skill',
  skill: 'simplify-paper',
  skill_version: '1',
  model: null,
  run_mode: 'batch',
  tier: 'distil',
  input_hash: 'h',
  body: {},
  citations: [],
  gates: {},
  review,
  reviewed_at: null,
  created_at: '2026-09-28T10:00:00Z',
});

const current = (options: ReturnType<typeof levelOptions>) => options.find((o) => o.current)?.level;

describe('levelOptions', () => {
  it('lists the three levels with the best version of each', () => {
    const options = levelOptions('bert', [explainer('expert', 'draft', 1), explainer('expert', 'approved', 2)], null);
    expect(options.map((o) => [o.level, o.chosen?.artifact.id ?? null])).toEqual([
      ['newcomer', null],
      ['practitioner', null],
      ['expert', 'expert-2'],
    ]);
    expect(options[0]?.href).toBe('/documents/bert/paper/explain?level=newcomer');
  });

  it('shows the level asked for, even one not made yet', () => {
    expect(current(levelOptions('bert', [explainer('expert', 'approved')], 'newcomer'))).toBe('newcomer');
  });

  it('otherwise shows the default level when it exists, else the first that does', () => {
    expect(current(levelOptions('bert', [explainer('expert', 'approved'), explainer('practitioner', 'draft')], null))).toBe('practitioner');
    expect(current(levelOptions('bert', [explainer('expert', 'approved')], 'bogus'))).toBe('expert');
    expect(current(levelOptions('bert', [], null))).toBe('practitioner');
  });

  it('never offers a rejected version', () => {
    expect(levelOptions('bert', [explainer('newcomer', 'rejected')], null)[0]?.chosen).toBeNull();
  });
});

describe('explainRequest', () => {
  it('asks simplify-paper for one level, as a derive job', () => {
    expect(explainRequest('d1', 'expert')).toEqual({ kind: 'derive', document_id: 'd1', skill: 'simplify-paper', params: { level: 'expert' } });
  });
});

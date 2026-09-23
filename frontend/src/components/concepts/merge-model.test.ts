import { describe, expect, it } from 'vitest';
import type { ConceptSummary, MergeProposal } from '../../lib/api/types/graph';
import { defaultSurvivor, mergePlan, mergeQueueReducer, similarityLabel } from './merge-model';

const c = (id: string, extra: Partial<ConceptSummary> = {}): ConceptSummary => ({ id, canonical: id, aliases: [], kind: 'concept', blurb: null, merged_into: null, origin: 'skill', ...extra });
const p = (edge: string, a = c('a'), b = c('b'), suggested: string | null = null): MergeProposal => ({
  edge_id: edge, a, b, similarity: null, confidence: null, rationale: null, suggested_survivor: suggested, origin: 'skill', evidence: [], created_at: '',
});

describe('merge model', () => {
  it('preselects the suggestion, else the curated side, else the one with a gloss', () => {
    expect([
      defaultSurvivor(p('1', c('a'), c('b'), 'b')),
      defaultSurvivor(p('2', c('a', { blurb: 'x' }), c('b', { origin: 'human' }))),
      defaultSurvivor(p('3', c('a'), c('b', { blurb: 'x' }))),
      defaultSurvivor(p('4', c('a'), c('b'), 'someone-else')),
    ]).toEqual(['b', 'b', 'b', 'a']);
  });

  it('merges the side that is not kept', () => {
    expect([mergePlan(p('1'), 'a').loser.id, mergePlan(p('1'), 'b').loser.id]).toEqual(['b', 'a']);
  });

  it('resolves, skips to the back, and restores to the original place once', () => {
    const [x, y, z] = [p('x'), p('y'), p('z')];
    const skipped = mergeQueueReducer({ items: [x, y, z] }, { type: 'skip', edgeId: 'x' });
    const resolved = mergeQueueReducer(skipped, { type: 'resolve', edgeId: 'z' });
    const restored = mergeQueueReducer(resolved, { type: 'restore', proposal: z, index: 1 });
    const twice = mergeQueueReducer(restored, { type: 'restore', proposal: z, index: 0 });
    expect([skipped, resolved, twice].map((s) => s.items.map((i) => i.edge_id))).toEqual([['y', 'z', 'x'], ['y', 'x'], ['y', 'z', 'x']]);
  });

  it('writes similarity as a percentage', () => {
    expect([similarityLabel(0.914), similarityLabel(null)]).toEqual(['91% similar', null]);
  });
});

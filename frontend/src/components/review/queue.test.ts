import { describe, expect, it } from 'vitest';
import { artifact } from './fixtures';
import { compareAnchors, filterQueue, flatOrder, groupQueue, isLowConfidence, isSuperseded } from './queue';

describe('compareAnchors', () => {
  it.each([
    ['ch2', 'ch10', -1],
    ['ch03', 'ch03/s01', -1],
    ['ch03/s02', 'ch03/s01', 1],
    [null, 'ch01', -1],
    ['ch01', 'ch01', 0],
  ] as const)('%s vs %s → %i', (a, b, sign) => {
    expect(Math.sign(compareAnchors(a, b))).toBe(sign);
  });
});

describe('groupQueue', () => {
  const titles = { d1: 'Thinking in Systems', d2: 'An Essay' };

  it('puts needs_review before draft, then orders by anchor, within each document', () => {
    const items = [
      artifact({ id: 'draft-ch1', document_id: 'd1', anchor: 'ch01', review: 'draft' }),
      artifact({ id: 'review-ch10', document_id: 'd1', anchor: 'ch10', review: 'needs_review' }),
      artifact({ id: 'review-ch2', document_id: 'd1', anchor: 'ch02', review: 'needs_review' }),
    ];
    expect(flatOrder(groupQueue(items, titles))).toEqual(['review-ch2', 'review-ch10', 'draft-ch1']);
  });

  it('lists documents with more items needing review first, then by title', () => {
    const items = [
      artifact({ document_id: 'd2', review: 'draft' }),
      artifact({ document_id: 'd1', review: 'needs_review' }),
      artifact({ document_id: 'd3', review: 'draft' }),
    ];
    const groups = groupQueue(items, titles);
    expect(groups.map((g) => [g.title, g.needsReview])).toEqual([
      ['Thinking in Systems', 1],
      ['An Essay', 0],
      ['Untitled document', 0],
    ]);
  });
});

describe('filterQueue', () => {
  const items = [
    artifact({ id: 'note', type: 'section_note', skill: 'distil-section', tier: 'distil', document_id: 'd1' }),
    artifact({ id: 'summary', type: 'chapter_summary', skill: 'summarize', tier: 'explore', document_id: 'd2' }),
  ];

  it.each([
    [{ type: 'chapter_summary' as const }, ['summary']],
    [{ skill: 'distil-section' }, ['note']],
    [{ tier: 'explore' as const }, ['summary']],
    [{ document: 'd1' }, ['note']],
    [{ type: '' as const, skill: '' }, ['note', 'summary']],
  ])('%o keeps %o', (filters, ids) => {
    expect(filterQueue(items, filters).map((i) => i.id)).toEqual(ids);
  });
});

describe('low confidence', () => {
  const flagged = artifact({ id: 'flagged', gates: { grounding: 1, flags: ['low_confidence'] } });
  const bodied = artifact({ id: 'bodied', type: 'figure_description', body: { confidence: 'low' } });
  const sure = artifact({ id: 'sure', body: { confidence: 'high' } });

  it.each([
    [flagged, true],
    [bodied, true],
    [sure, false],
  ])('isLowConfidence(%#) → %s', (item, expected) => {
    expect(isLowConfidence(item)).toBe(expected);
  });

  it('the filter keeps only low-confidence items, and an empty value keeps all', () => {
    expect(filterQueue([flagged, bodied, sure], { confidence: 'low' }).map((i) => i.id)).toEqual(['flagged', 'bodied']);
    expect(filterQueue([flagged, bodied, sure], { confidence: '' })).toHaveLength(3);
  });
});

describe('isSuperseded', () => {
  const versions = [
    artifact({ version: 1, review: 'draft' }),
    artifact({ version: 2, review: 'rejected' }),
    artifact({ version: 3, review: 'approved' }),
  ];

  it.each([
    [1, true],
    [2, true],
    [3, false],
  ])('version %i superseded: %s', (version, expected) => {
    expect(isSuperseded({ version }, versions)).toBe(expected);
  });

  it('does not count a newer version that was rejected', () => {
    expect(isSuperseded({ version: 1 }, [artifact({ version: 1 }), artifact({ version: 2, review: 'rejected' })])).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { artifact } from './fixtures';
import { compareAnchors, filterQueue, flatOrder, groupQueue, latestPerScope } from './queue';

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

describe('latestPerScope', () => {
  it('keeps only the newest version of each scope', () => {
    const items = [
      artifact({ id: 'old', anchor: 'ch01/s02', version: 1, review: 'needs_review' }),
      artifact({ id: 'new', anchor: 'ch01/s02', version: 2 }),
      artifact({ id: 'other-type', anchor: 'ch01/s02', type: 'chapter_summary', version: 1 }),
      artifact({ id: 'other-anchor', anchor: 'ch01/s03', version: 1 }),
    ];
    expect(latestPerScope(items).map((i) => i.id)).toEqual(['new', 'other-type', 'other-anchor']);
  });
});

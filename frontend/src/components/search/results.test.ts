import { describe, expect, it } from 'vitest';
import type { SearchDocument, SearchHit, SearchResponse } from '../../lib/api/types/search';
import { buildResults, highlightSegments, stepHit } from './results';

const meadows: SearchDocument = { id: 'm', slug: 'meadows', title: 'Thinking in Systems', authors: ['Donella Meadows'] };
const senge: SearchDocument = { id: 's', slug: 'senge', title: 'The Fifth Discipline', authors: ['Peter Senge'] };

function hit(kind: SearchHit['kind'], anchor: string | null, extra: Partial<SearchHit> = {}): SearchHit {
  return { kind, anchor, score: 1, snippet: `${kind} ${anchor}`, ...extra };
}

describe('buildResults', () => {
  const response: SearchResponse = {
    intent: 'discovery',
    took_ms: 12,
    groups: [
      { document: meadows, hits: [hit('block', 'ch01/p002'), hit('distillation', 'ch01'), hit('distillation', null)] },
      { document: senge, hits: [hit('block', 'ch03/s01/p004')] },
    ],
  };

  it('splits each document into what you know and evidence, keeping the display order for keys', () => {
    const view = buildResults(response);
    expect(view.groups.map((g) => [g.known.map((h) => h.hit.anchor), g.evidence.map((h) => h.hit.anchor)])).toEqual([
      [['ch01', null], ['ch01/p002']],
      [[], ['ch03/s01/p004']],
    ]);
    expect(view.order.map((h) => h.href)).toEqual([
      '/documents/meadows/read/ch01',
      '/documents/meadows',
      '/documents/meadows/read/ch01/p002',
      '/documents/senge/read/ch03/s01/p004',
    ]);
    expect(view.resolved).toBeNull();
  });

  it('points an addressed query at the resolved chapter', () => {
    const view = buildResults({
      intent: 'addressed',
      took_ms: 1,
      resolved: { document: meadows, anchor: 'ch03' },
      groups: [{ document: meadows, hits: [hit('block', 'ch03', { heading: 'Why systems surprise us' })] }],
    });
    expect(view.resolved).toEqual({
      document: meadows,
      anchor: 'ch03',
      href: '/documents/meadows/read/ch03',
      heading: 'Why systems surprise us',
    });
  });
});

describe('highlightSegments', () => {
  it('marks the given ranges', () => {
    expect(highlightSegments('a stock and a flow', [[2, 7], [14, 18]])).toEqual([
      { text: 'a ', marked: false },
      { text: 'stock', marked: true },
      { text: ' and a ', marked: false },
      { text: 'flow', marked: true },
    ]);
  });

  it('merges overlapping ranges, sorts them and clamps them to the snippet', () => {
    expect(highlightSegments('abcdef', [[4, 99], [1, 3], [2, 4], [-5, 0]])).toEqual([
      { text: 'a', marked: false },
      { text: 'bcdef', marked: true },
    ]);
  });

  it('returns the whole snippet unmarked without ranges', () => {
    expect(highlightSegments('plain', null)).toEqual([{ text: 'plain', marked: false }]);
  });
});

describe('stepHit', () => {
  it('moves between the query box (-1) and the last hit without wrapping', () => {
    expect([stepHit(-1, 1, 3), stepHit(2, 1, 3), stepHit(0, -1, 3), stepHit(-1, -1, 3), stepHit(-1, 1, 0)]).toEqual([0, 2, -1, -1, -1]);
  });
});

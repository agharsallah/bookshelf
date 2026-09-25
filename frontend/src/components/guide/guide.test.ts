import { describe, expect, it } from 'vitest';
import example from '../../../../skills/write-guide/example.json';
import type { TreeNode } from '../../lib/api/types/documents';
import {
  chapterRows,
  durationLabel,
  glance,
  minutesFor,
  parseGuide,
  roleColor,
  roleCounts,
  themeMatrix,
  unitOf,
  type Guide,
  type Unit,
} from './guide';

const span = (text: string, ...cites: string[]) => ({ text, cites });
const unit = (anchor: string, words: number, frontMatter = false): Unit => ({ anchor, heading: `Heading ${anchor}`, words, frontMatter });

function guideOf(body: unknown): Guide {
  const guide = parseGuide(body as Record<string, unknown>);
  if (!guide) throw new Error('not a guide');
  return guide;
}

describe('parseGuide', () => {
  it('reads the write-guide example: sections in order, journey, themes and numbers', () => {
    const guide = guideOf(example);
    expect(guide.sections.map((s) => s.key)).toEqual(['overview', 'map', 'deep_dive', 'practice']);
    expect(guide.sections[1]?.blocks[0]?.type).toBe('diagram');
    expect(guide.journey.map((j) => j.anchor)).toEqual(['ch01', 'ch02', 'ch03', 'ch04', 'ch05', 'ch06', 'ch07']);
    expect(guide.journey[0]?.role).toBe('setup');
    expect(guide.themes).toHaveLength(3);
    expect(guide.numbers[0]?.value).toBe('~80%');
  });

  it('restores the canonical order, keeps the first duplicate and fills missing titles', () => {
    const guide = guideOf({
      sections: [
        { key: 'practice', title: ' ', blocks: [] },
        { key: 'overview', title: 'In short', blocks: [] },
        { key: 'overview', title: 'Again', blocks: [] },
        { key: 'thesis', title: 'x', blocks: [] },
      ],
    });
    expect(guide.sections.map((s) => [s.key, s.title])).toEqual([
      ['overview', 'In short'],
      ['practice', 'Putting the book to work'],
    ]);
    expect(guide).toMatchObject({ journey: [], themes: [], numbers: [] });
  });

  it('is null for a body without guide sections', () => {
    expect(parseGuide({ blocks: [] })).toBeNull();
  });

  it('drops malformed list entries and spans, and an unknown role becomes null', () => {
    const guide = guideOf({
      sections: [{ key: 'overview', blocks: [] }],
      journey: [{ anchor: 'ch01', role: 'prologue', takeaway: [span('a', 'ch01/p001'), { nope: 1 }] }, { role: 'setup' }],
      themes: [{ name: '', spans: [] }, { name: 'Flow', spans: 'x' }],
      numbers: [{ value: '80%', label: [span('b')] }, { label: [] }],
    });
    expect(guide.journey).toEqual([{ anchor: 'ch01', role: null, takeaway: [span('a', 'ch01/p001')] }]);
    expect(guide.themes).toEqual([{ name: 'Flow', spans: [] }]);
    expect(guide.numbers).toEqual([{ value: '80%', label: [span('b')] }]);
  });
});

describe('unitOf', () => {
  it('counts the words of every block under the chapter', () => {
    const leaf = (anchor: string, text: string): TreeNode =>
      ({ anchor, kind: 'paragraph', heading: null, text, meta: {}, children: [] }) as unknown as TreeNode;
    const chapter = {
      anchor: 'ch01',
      kind: 'chapter',
      heading: 'Why work waits',
      text: null,
      meta: {},
      children: [leaf('ch01/p001', 'one two three'), { ...leaf('ch01/s01', ''), children: [leaf('ch01/s01/p001', 'four five')] }],
    } as unknown as TreeNode;
    expect(unitOf(chapter)).toEqual({ anchor: 'ch01', heading: 'Why work waits', words: 5, frontMatter: false });
  });
});

describe('chapterRows', () => {
  const journey = [
    { anchor: 'ch01', role: 'setup' as const, takeaway: [span('Frames it.', 'ch01/p001')] },
    { anchor: 'ch02', role: 'concept' as const, takeaway: [] },
    { anchor: 'ch99', role: 'evidence' as const, takeaway: [] },
  ];

  it('joins roles to chapters, sizes bars by reading time and keeps unlisted real chapters', () => {
    const rows = chapterRows([unit('fm01', 300, true), unit('ch01', 2380), unit('ch02', 4760), unit('ch03', 1190)], journey);
    expect(rows.map((r) => [r.anchor, r.number, r.minutes, r.role])).toEqual([
      ['ch01', 1, 10, 'setup'],
      ['ch02', 2, 20, 'concept'],
      ['ch03', 3, 5, null],
    ]);
    expect(rows.map((r) => r.share)).toEqual([0.5, 1, 0.25]);
    expect(rows.reduce((sum, r) => sum + r.weight, 0)).toBeCloseTo(1);
    expect(rows[0]?.takeaway).toEqual([span('Frames it.', 'ch01/p001')]);
  });

  it('keeps front matter the guide describes', () => {
    const rows = chapterRows([unit('fm01', 900, true)], [{ anchor: 'fm01', role: 'setup', takeaway: [] }]);
    expect(rows.map((r) => r.anchor)).toEqual(['fm01']);
  });

  it('counts roles in role order', () => {
    const rows = chapterRows([unit('ch01', 10), unit('ch02', 10), unit('ch03', 10)], [
      { anchor: 'ch01', role: 'evidence', takeaway: [] },
      { anchor: 'ch02', role: 'setup', takeaway: [] },
      { anchor: 'ch03', role: 'evidence', takeaway: [] },
    ]);
    expect(roleCounts(rows)).toEqual([
      { role: 'setup', count: 1 },
      { role: 'evidence', count: 2 },
    ]);
  });
});

describe('themeMatrix', () => {
  it('places each theme in the chapters its spans cite, segment-aware, with relative heat', () => {
    const rows = chapterRows([unit('ch1', 10), unit('ch2', 10), unit('ch10', 10)], []);
    const matrix = themeMatrix(
      [
        { name: 'Flow', spans: [span('a', 'ch1/p001', 'ch1/p002', 'ch1/p003', 'ch1/p004'), span('b', 'ch10/p001', 'ch1/p001')] },
        { name: 'Slack', spans: [span('c', 'ch2/s01/p001')] },
      ],
      rows,
    );
    expect(matrix.map((r) => [r.name, r.cells.map((c) => c.count), r.reach])).toEqual([
      ['Flow', [4, 0, 1], 2],
      ['Slack', [0, 1, 0], 1],
    ]);
    expect(matrix[0]?.cells.map((c) => c.level)).toEqual([4, 0, 1]);
    expect(matrix[0]?.cells[0]?.first).toBe('ch1/p001');
    expect(matrix[0]?.cells[1]?.first).toBeNull();
  });
});

describe('labels and stats', () => {
  it('formats durations', () => {
    expect([durationLabel(45), durationLabel(180), durationLabel(380)]).toEqual(['45 min', '3 h', '6 h 20 min']);
    expect([minutesFor(0), minutesFor(20), minutesFor(2380)]).toEqual([0, 1, 10]);
  });

  it('colours roles by fixed series slot, the unknown as other', () => {
    expect([roleColor('setup'), roleColor('synthesis'), roleColor(null)]).toEqual([
      'var(--series-1)',
      'var(--series-6)',
      'var(--series-other)',
    ]);
  });

  it('summarises the book and what the guide maps', () => {
    const guide = guideOf(example);
    const rows = chapterRows(guide.journey.map((j) => unit(j.anchor, 2380)), guide.journey);
    expect(glance(guide, rows, 212)).toEqual([
      { label: 'chapters', value: '7' },
      { label: 'to read in full', value: '1 h 10 min' },
      { label: 'pages', value: '212' },
      { label: 'core ideas', value: '4' },
      { label: 'diagrams and charts', value: '2' },
    ]);
  });
});

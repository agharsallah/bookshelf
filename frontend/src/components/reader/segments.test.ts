import { describe, expect, it } from 'vitest';
import { clip, pieces, segment, topColor, type Mark } from './segments';

const mark = (id: string, start: number, end: number, color: Mark['color'] = 'amber'): Mark => ({
  id,
  start,
  end,
  color,
});

const shape = (length: number, marks: Mark[]) =>
  segment(length, marks).map((s) => [s.start, s.end, s.marks.map((m) => m.id).join('+')]);

describe('segment', () => {
  it('is one plain segment when there are no marks', () => {
    expect(shape(10, [])).toEqual([[0, 10, '']]);
  });

  it('splits around a single mark', () => {
    expect(shape(10, [mark('a', 2, 5)])).toEqual([
      [0, 2, ''],
      [2, 5, 'a'],
      [5, 10, ''],
    ]);
  });

  it('gives overlapping marks a shared middle segment', () => {
    expect(shape(12, [mark('a', 0, 6), mark('b', 4, 10)])).toEqual([
      [0, 4, 'a'],
      [4, 6, 'a+b'],
      [6, 10, 'b'],
      [10, 12, ''],
    ]);
  });

  it('handles a mark nested inside another', () => {
    expect(shape(10, [mark('outer', 1, 9), mark('inner', 3, 5)])).toEqual([
      [0, 1, ''],
      [1, 3, 'outer'],
      [3, 5, 'outer+inner'],
      [5, 9, 'outer'],
      [9, 10, ''],
    ]);
  });

  it('clips marks to the text and drops empty ones', () => {
    expect(shape(5, [mark('a', -3, 2), mark('b', 4, 50), mark('c', 3, 3), mark('d', 8, 9)])).toEqual([
      [0, 2, 'a'],
      [2, 4, ''],
      [4, 5, 'b'],
    ]);
  });

  it('touching marks do not overlap', () => {
    expect(shape(6, [mark('a', 0, 3), mark('b', 3, 6)])).toEqual([
      [0, 3, 'a'],
      [3, 6, 'b'],
    ]);
  });
});

describe('topColor', () => {
  it('is the newest mark’s colour where marks overlap', () => {
    const [, middle] = segment(10, [mark('a', 0, 6, 'rose'), mark('b', 4, 10, 'sky')]);
    expect(topColor(middle!)).toBe('sky');
  });
});

describe('pieces', () => {
  it('keeps line offsets into the original text', () => {
    expect(pieces('ab\ncde')).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 6 },
    ]);
  });

  it('excludes list markers from list items', () => {
    const text = '- first\n12. second';
    const [a, b] = pieces(text, { stripMarkers: true });
    expect(text.slice(a!.start, a!.end)).toBe('first');
    expect(text.slice(b!.start, b!.end)).toBe('second');
  });
});

describe('clip', () => {
  it('returns only the part of each segment inside the piece', () => {
    const segs = segment(10, [mark('a', 2, 8)]);
    expect(clip(segs, { start: 5, end: 10 }).map((s) => [s.start, s.end, s.marks.length])).toEqual([
      [5, 8, 1],
      [8, 10, 0],
    ]);
  });
});

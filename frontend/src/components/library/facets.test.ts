import { describe, expect, it } from 'vitest';
import { bucketIndex, bucketsOf, DYES, dyeOf, facet, FIXED_PALETTE, NO_THEME, parseDimension, readingBucket, shelfPalette, studyBucket } from './facets';
import { NOT_READ } from './progress';
import { card, summary } from './test-books';

const artifacts = (approved: number, draft = 0, needs_review = 0) => ({ approved, draft, needs_review, rejected: 0 });

/** WCAG relative luminance and contrast, as in styles/tokens-contrast.test.ts. */
function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [hi = 0, lo = 0] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('readingBucket', () => {
  it('is not started, reading or finished', () => {
    expect(readingBucket(NOT_READ)).toBe('unread');
    expect(readingBucket({ share: 0.3, lastRead: 't' })).toBe('reading');
    expect(readingBucket({ share: 1, lastRead: 't' })).toBe('finished');
  });
});

describe('studyBucket', () => {
  it('is ready with any approved material, drafts when only drafts wait, else nothing', () => {
    expect(studyBucket(artifacts(1, 9))).toBe('ready');
    expect(studyBucket(artifacts(0, 0, 2))).toBe('drafts');
    expect(studyBucket(artifacts(0))).toBe('none');
  });
});

describe('bucketsOf', () => {
  it('places a document in every dimension', () => {
    const doc = summary('bert', { genre: 'paper', artifacts: artifacts(0, 3) });
    expect(bucketsOf(doc, NOT_READ)).toEqual({ kind: 'paper', reading: 'unread', study: 'drafts', theme: NO_THEME });
    const carded = summary('bert', { catalogue: card('Machine learning') });
    expect(bucketsOf(carded, NOT_READ).theme).toBe('Machine learning');
  });
});

describe('facet', () => {
  it('counts every bucket in order, the empty ones too, with its share', () => {
    const books = [
      { kind: 'book', reading: 'unread', study: 'none', theme: NO_THEME },
      { kind: 'paper', reading: 'unread', study: 'ready', theme: NO_THEME },
      { kind: 'book', reading: 'finished', study: 'ready', theme: NO_THEME },
      { kind: 'book', reading: 'reading', study: 'none', theme: NO_THEME },
    ] as const;
    expect(facet(FIXED_PALETTE, 'kind', books).map((s) => [s.value, s.count, s.share])).toEqual([
      ['book', 3, 0.75],
      ['paper', 1, 0.25],
      ['article', 0, 0],
    ]);
    expect(facet(FIXED_PALETTE, 'reading', []).every((s) => s.count === 0 && s.share === 0)).toBe(true);
  });
});

describe('dyes', () => {
  it('keep the spine’s paper-coloured type readable at 7:1', () => {
    for (const dye of Object.values(DYES)) expect(contrast(dye, '#f5efe0')).toBeGreaterThanOrEqual(7);
  });

  it('mean the same across dimensions: slate is nothing yet, forest is done', () => {
    expect(dyeOf(FIXED_PALETTE, 'reading', 'unread')).toBe(DYES.slate);
    expect(dyeOf(FIXED_PALETTE, 'study', 'none')).toBe(DYES.slate);
    expect(dyeOf(FIXED_PALETTE, 'theme', NO_THEME)).toBe(DYES.slate);
    expect(dyeOf(FIXED_PALETTE, 'reading', 'finished')).toBe(DYES.forest);
    expect(dyeOf(FIXED_PALETTE, 'study', 'ready')).toBe(DYES.forest);
  });

  it('fall back to slate and the end of the order for an unknown bucket', () => {
    expect(dyeOf(FIXED_PALETTE, 'kind', 'poem')).toBe(DYES.slate);
    expect(bucketIndex(FIXED_PALETTE, 'kind', 'paper')).toBe(1);
    expect(bucketIndex(FIXED_PALETTE, 'kind', 'poem')).toBe(3);
  });
});

describe('shelfPalette', () => {
  const shelf = (...themes: (string | null)[]) => shelfPalette(themes.map((theme) => ({ catalogue: theme === null ? null : { theme } })));

  it('orders the shelf’s themes by use, then A to Z, with "No theme yet" last', () => {
    expect(shelf('Career', 'Machine learning', null, 'Machine learning', 'Architecture').theme.map((b) => [b.value, b.dye])).toEqual([
      ['Machine learning', 'ink'],
      ['Architecture', 'teal'],
      ['Career', 'plum'],
      [NO_THEME, 'slate'],
    ]);
  });

  it('gives the six most used themes a dye each and the rest stone', () => {
    const themes = shelf('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h').theme;
    expect(themes.map((b) => b.dye)).toEqual(['ink', 'teal', 'plum', 'forest', 'ochre', 'rust', 'stone', 'stone', 'slate']);
    expect(themes.at(-1)?.label).toBe('No theme yet');
  });

  it('keeps the fixed dimensions as they are', () => {
    expect(shelf('x').kind).toBe(FIXED_PALETTE.kind);
  });
});

describe('parseDimension', () => {
  it('accepts the known dimensions and falls back to kind', () => {
    expect(parseDimension('study')).toBe('study');
    expect(parseDimension('colour')).toBe('kind');
    expect(parseDimension(null)).toBe('kind');
  });
});

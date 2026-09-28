import { describe, expect, it } from 'vitest';
import { bookColours, dyeStyle, placeStyle, transitionName } from './book-style';
import { DYES, shelfPalette } from './facets';

const buckets = { kind: 'paper', reading: 'finished', study: 'none', theme: 'Machine learning' } as const;
const palette = shelfPalette([{ catalogue: { theme: 'Career' } }, { catalogue: { theme: 'Machine learning' } }, { catalogue: { theme: 'Machine learning' } }]);
const colours = bookColours(palette, buckets);

describe('bookColours', () => {
  it('finds the book’s dye and group in every dimension of the shelf’s palette', () => {
    expect(colours).toEqual({
      dyes: { kind: DYES.teal, reading: DYES.forest, study: DYES.slate, theme: DYES.ink },
      groups: { kind: 1, reading: 1, study: 2, theme: 0 },
    });
  });
});

describe('dyeStyle', () => {
  it('carries the dye of every dimension and the book’s own shade', () => {
    expect(dyeStyle(colours, 6)).toBe(`--c-kind:${DYES.teal};--c-reading:${DYES.forest};--c-study:${DYES.slate};--c-theme:${DYES.ink};--shade:6%`);
  });
});

describe('placeStyle', () => {
  it('carries the order, the group in every dimension and a unique transition name', () => {
    expect(placeStyle('1f0c-9a', colours, 3)).toBe('--i:3;--g-kind:1;--g-reading:1;--g-study:2;--g-theme:0;view-transition-name:book-1f0c-9a');
  });

  it('keeps the transition name a valid identifier', () => {
    expect(transitionName('a b.c/d')).toBe('book-abcd');
  });
});
